import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView, Platform } from 'react-native';
import { LocationObject } from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

// #region agent log
const debugLog = (location: string, message: string, data: object, hypothesisId: string) => {
  fetch('http://127.0.0.1:7242/ingest/0595a1ca-db13-40a1-91db-65b59f7fff34',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location,message,data,timestamp:Date.now(),sessionId:'debug-session',hypothesisId})}).catch(()=>{});
};
// #endregion

// Memory 데이터 타입 정의
interface Memory {
  id: string;
  text: string;
  latitude: number;
  longitude: number;
  date: string;
}

const STORAGE_KEY = '@memories';
const PROXIMITY_THRESHOLD = 50; // 50 meters

// ============================================
// 1. Haversine 공식을 사용한 거리 계산 헬퍼 함수
// 두 좌표 사이의 거리를 미터 단위로 반환
// ============================================
function getDistanceFromLatLonInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // 지구 반지름 (미터)
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance;
}

function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}

// 거리를 읽기 좋은 형식으로 변환
function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m away`;
  }
  return `${(meters / 1000).toFixed(1)}km away`;
}

interface MapScreenProps {
  location: LocationObject;
}

export default function MapScreen({ location }: MapScreenProps) {
  const [memoryText, setMemoryText] = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [saveMessage, setSaveMessage] = useState('');
  
  // 시뮬레이션 모드: 가상 위치로 테스트
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedOffset, setSimulatedOffset] = useState(0); // 위도 오프셋
  
  // 이미 알림을 보낸 메모리 ID를 추적 (세션당 한 번만 알림)
  const alertedMemoriesRef = useRef<Set<string>>(new Set());

  // 현재 사용할 위치 (실제 또는 시뮬레이션)
  const currentLat = location.coords.latitude + simulatedOffset;
  const currentLon = location.coords.longitude;

  // #region agent log
  useEffect(() => {
    debugLog('MapScreen.web.tsx:mount', 'MapScreen (web) mounted', { lat: location?.coords?.latitude, lng: location?.coords?.longitude }, 'A');
  }, []);
  // #endregion

  // 앱 시작시 저장된 메모리 불러오기
  useEffect(() => {
    loadMemories();
  }, []);

  // ============================================
  // 2. 근접 체크 로직 - 위치나 메모리가 변경될 때 실행
  // ============================================
  useEffect(() => {
    if (!location || !location.coords || memories.length === 0) return;

    memories.forEach((memory) => {
      const distance = getDistanceFromLatLonInMeters(
        currentLat,
        currentLon,
        memory.latitude,
        memory.longitude
      );

      // 50m 이내이고 아직 알림을 보내지 않은 경우
      if (distance < PROXIMITY_THRESHOLD && !alertedMemoriesRef.current.has(memory.id)) {
        // 알림 표시
        const message = `🎉 You found a memory!\n\n"${memory.text}"\n\nSaved on: ${memory.date}`;
        
        // 웹에서는 window.alert 사용
        if (Platform.OS === 'web') {
          window.alert(message);
        } else {
          // React Native Alert (모바일)
          import('react-native').then(({ Alert }) => {
            Alert.alert('Memory Found!', message);
          });
        }

        // 이 메모리에 대해 알림을 보냈음을 기록
        alertedMemoriesRef.current.add(memory.id);
        
        // #region agent log
        debugLog('MapScreen.web.tsx:geofence', 'Memory unlocked!', { memoryId: memory.id, distance }, 'A');
        // #endregion
        
        console.log(`🔓 Inside Geofence: Memory "${memory.text}" (${Math.round(distance)}m)`);
      }
    });
  }, [location, memories, simulatedOffset]);

  // 텔레포트 (100m 이동)
  const handleTeleport = () => {
    setIsSimulating(true);
    setSimulatedOffset(prev => prev + 0.001); // 약 100m 북쪽으로 이동
    console.log('🚀 Teleported! Offset:', simulatedOffset + 0.001);
  };

  // 위치 리셋 (실제 GPS로 복귀)
  const handleResetLocation = () => {
    setIsSimulating(false);
    setSimulatedOffset(0);
    alertedMemoriesRef.current.clear(); // 알림 기록 초기화
    console.log('📍 Location reset to real GPS');
  };

  // AsyncStorage에서 메모리 목록 불러오기
  const loadMemories = async () => {
    try {
      const storedMemories = await AsyncStorage.getItem(STORAGE_KEY);
      if (storedMemories) {
        setMemories(JSON.parse(storedMemories));
      }
    } catch (error) {
      console.error('메모리 불러오기 실패:', error);
    }
  };

  // 메모리 저장하기
  const handleSaveMemory = async () => {
    // 1. 위치 데이터 확인
    if (!location || !location.coords) {
      showMessage('❌ 위치 정보를 찾을 수 없습니다.');
      return;
    }

    // 텍스트가 비어있는지 확인
    if (!memoryText.trim()) {
      showMessage('✏️ 메모리 내용을 입력해주세요.');
      return;
    }

    try {
      // 2. 메모리 객체 생성
      const newMemory: Memory = {
        id: Date.now().toString(),
        text: memoryText.trim(),
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        date: new Date().toLocaleString('ko-KR'),
      };

      // 3. 기존 목록에 추가하여 저장
      const updatedMemories = [...memories, newMemory];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
      
      // 상태 업데이트
      setMemories(updatedMemories);
      
      // 4. 입력 필드 초기화
      setMemoryText('');
      
      // 5. 성공 메시지 표시
      showMessage('✨ Memory Saved!');

      // #region agent log
      debugLog('MapScreen.web.tsx:saveMemory', 'Memory saved successfully', { memory: newMemory }, 'A');
      // #endregion
    } catch (error) {
      console.error('메모리 저장 실패:', error);
      showMessage('❌ 저장에 실패했습니다.');
    }
  };

  // 메시지 표시 함수 (웹에서는 Alert 대신 텍스트로 표시)
  const showMessage = (message: string) => {
    setSaveMessage(message);
    setTimeout(() => setSaveMessage(''), 3000);
  };

  // #region agent log
  debugLog('MapScreen.web.tsx:render', 'MapScreen (web) rendering', { platform: 'web' }, 'B');
  // #endregion

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.webMapPlaceholder}>
        <Text style={styles.webMapIcon}>🗺️</Text>
        <Text style={styles.webMapTitle}>Memory Delivery</Text>
        
        {/* 시뮬레이션 상태 표시 */}
        {isSimulating && (
          <View style={styles.simulationBadge}>
            <Text style={styles.simulationBadgeText}>🎮 SIMULATION MODE</Text>
          </View>
        )}
        
        <Text style={styles.webMapText}>
          {isSimulating ? '시뮬레이션 위치' : '현재 위치'}
        </Text>
        <Text style={styles.webMapCoords}>
          위도: {currentLat.toFixed(6)}
        </Text>
        <Text style={styles.webMapCoords}>
          경도: {currentLon.toFixed(6)}
        </Text>
        
        {/* 디버그: 텔레포트 버튼 */}
        <View style={styles.debugButtonContainer}>
          <TouchableOpacity style={styles.teleportButton} onPress={handleTeleport}>
            <Text style={styles.teleportButtonText}>🚀 Teleport (+100m)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.resetButton} onPress={handleResetLocation}>
            <Text style={styles.resetButtonText}>📍 Reset Location</Text>
          </TouchableOpacity>
        </View>
        
        {isSimulating && (
          <Text style={styles.offsetText}>
            오프셋: +{(simulatedOffset * 111000).toFixed(0)}m 북쪽
          </Text>
        )}
      </View>

      {/* Memory Input Section */}
      <View style={styles.inputSection}>
        <TextInput
          style={styles.stickyNoteInput}
          placeholder="Leave a memory here..."
          placeholderTextColor="#a89f6a"
          value={memoryText}
          onChangeText={setMemoryText}
          multiline
          numberOfLines={3}
        />
        
        {/* Save Button */}
        <TouchableOpacity style={styles.saveButton} onPress={handleSaveMemory}>
          <Text style={styles.saveButtonIcon}>📌</Text>
          <Text style={styles.saveButtonText}>Stick Memory</Text>
        </TouchableOpacity>

        {/* Save Message */}
        {saveMessage ? (
          <Text style={styles.saveMessage}>{saveMessage}</Text>
        ) : null}
      </View>

      {/* Debug View: Saved Memories List with Distance */}
      <View style={styles.debugSection}>
        <Text style={styles.debugTitle}>📋 저장된 메모리 ({memories.length}개)</Text>
        {memories.length === 0 ? (
          <Text style={styles.emptyText}>아직 저장된 메모리가 없습니다.</Text>
        ) : (
          memories.map((memory) => {
            // 시뮬레이션 좌표를 사용하여 거리 계산
            const distance = getDistanceFromLatLonInMeters(
              currentLat,
              currentLon,
              memory.latitude,
              memory.longitude
            );
            const isUnlocked = distance < PROXIMITY_THRESHOLD;

            return (
              <View
                key={memory.id}
                style={[
                  styles.memoryCard,
                  isUnlocked ? styles.memoryCardUnlocked : styles.memoryCardLocked,
                ]}
              >
                {/* 잠금/해제 상태 배지 */}
                <View style={styles.statusBadge}>
                  <Text style={styles.statusIcon}>{isUnlocked ? '🔓' : '🔒'}</Text>
                  <Text
                    style={[
                      styles.distanceText,
                      isUnlocked ? styles.distanceUnlocked : styles.distanceLocked,
                    ]}
                  >
                    {formatDistance(distance)}
                  </Text>
                </View>

                {/* 메모리 내용 - 잠금시 플레이스홀더 표시 */}
                {isUnlocked ? (
                  <Text style={styles.memoryText}>📝 {memory.text}</Text>
                ) : (
                  <Text style={styles.memoryTextLocked}>
                    🔒 Visit this location to unlock memory.
                  </Text>
                )}
                
                <Text style={[styles.memoryDate, !isUnlocked && styles.memoryDateLocked]}>
                  🕐 {memory.date}
                </Text>
                <Text style={styles.memoryLocation}>
                  📍 {memory.latitude.toFixed(4)}, {memory.longitude.toFixed(4)}
                </Text>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  webMapPlaceholder: {
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  webMapIcon: {
    fontSize: 60,
    marginBottom: 16,
  },
  webMapTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 20,
    letterSpacing: 1,
  },
  webMapText: {
    fontSize: 16,
    color: '#a0a0a0',
    marginBottom: 8,
  },
  webMapCoords: {
    fontSize: 14,
    color: '#6366f1',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  // Simulation Mode Styles
  simulationBadge: {
    backgroundColor: '#ef4444',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 16,
  },
  simulationBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  debugButtonContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  teleportButton: {
    backgroundColor: '#8b5cf6',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  teleportButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  resetButton: {
    backgroundColor: '#374151',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#6b7280',
  },
  resetButtonText: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '600',
  },
  offsetText: {
    marginTop: 12,
    fontSize: 12,
    color: '#f59e0b',
    fontStyle: 'italic',
  },
  // Memory Input Section
  inputSection: {
    padding: 20,
    alignItems: 'center',
  },
  stickyNoteInput: {
    width: '100%',
    maxWidth: 400,
    minHeight: 100,
    backgroundColor: '#FFF7D6',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#5a5230',
    textAlignVertical: 'top',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#e8dfa3',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f59e0b',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 30,
    marginTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  saveButtonIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  saveMessage: {
    marginTop: 12,
    fontSize: 16,
    color: '#10b981',
    fontWeight: '600',
  },
  // Debug Section
  debugSection: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#333355',
    marginTop: 10,
  },
  debugTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 16,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  memoryCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
  },
  // 해제됨 (50m 이내) - 밝은 노란색 배경
  memoryCardUnlocked: {
    backgroundColor: '#FFF9C4',
    borderLeftColor: '#f59e0b',
  },
  // 잠금됨 (50m 이상) - 회색 배경
  memoryCardLocked: {
    backgroundColor: '#3a3a5e',
    borderLeftColor: '#666680',
    opacity: 0.7,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  distanceText: {
    fontSize: 13,
    fontWeight: '600',
  },
  distanceUnlocked: {
    color: '#d97706',
  },
  distanceLocked: {
    color: '#888888',
  },
  memoryText: {
    fontSize: 16,
    marginBottom: 8,
    lineHeight: 22,
    color: '#5a5230', // 해제 상태 기본 색상 (노란 배경에 어울리는 갈색)
  },
  memoryTextLocked: {
    color: '#888888',
    fontStyle: 'italic',
  },
  memoryDate: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 4,
  },
  memoryDateLocked: {
    color: '#888888',
  },
  memoryLocation: {
    fontSize: 11,
    color: '#6366f1',
    fontFamily: 'monospace',
  },
});

