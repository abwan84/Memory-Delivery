import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView, Platform, Alert, Dimensions } from 'react-native';
import MapView, { Region, Marker } from 'react-native-maps';
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
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// ============================================
// Haversine 공식을 사용한 거리 계산 헬퍼 함수
// ============================================
function getDistanceFromLatLonInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}

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
  
  // 시뮬레이션 모드
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedOffset, setSimulatedOffset] = useState(0);
  
  const alertedMemoriesRef = useRef<Set<string>>(new Set());
  const mapRef = useRef<MapView>(null);

  // 현재 사용할 위치 (실제 또는 시뮬레이션)
  const currentLat = location.coords.latitude + simulatedOffset;
  const currentLon = location.coords.longitude;

  // #region agent log
  useEffect(() => {
    debugLog('MapScreen.tsx:mount', 'MapScreen mounted', { lat: location?.coords?.latitude, lng: location?.coords?.longitude }, 'A');
  }, []);
  // #endregion

  // 앱 시작시 저장된 메모리 불러오기
  useEffect(() => {
    loadMemories();
  }, []);

  // 근접 체크 로직
  useEffect(() => {
    if (!location || !location.coords || memories.length === 0) return;

    memories.forEach((memory) => {
      const distance = getDistanceFromLatLonInMeters(
        currentLat,
        currentLon,
        memory.latitude,
        memory.longitude
      );

      if (distance < PROXIMITY_THRESHOLD && !alertedMemoriesRef.current.has(memory.id)) {
        Alert.alert(
          '🎉 Memory Found!',
          `"${memory.text}"\n\nSaved on: ${memory.date}`,
          [{ text: 'OK' }]
        );
        alertedMemoriesRef.current.add(memory.id);
        debugLog('MapScreen.tsx:geofence', 'Memory unlocked!', { memoryId: memory.id, distance }, 'A');
      }
    });
  }, [location, memories, simulatedOffset]);

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

  const handleSaveMemory = async () => {
    if (!location || !location.coords) {
      showMessage('❌ 위치 정보를 찾을 수 없습니다.');
      return;
    }

    if (!memoryText.trim()) {
      showMessage('✏️ 메모리 내용을 입력해주세요.');
      return;
    }

    try {
      const newMemory: Memory = {
        id: Date.now().toString(),
        text: memoryText.trim(),
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        date: new Date().toLocaleString('ko-KR'),
      };

      const updatedMemories = [...memories, newMemory];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
      setMemories(updatedMemories);
      setMemoryText('');
      showMessage('✨ Memory Saved!');
      debugLog('MapScreen.tsx:saveMemory', 'Memory saved', { memory: newMemory }, 'A');
    } catch (error) {
      console.error('메모리 저장 실패:', error);
      showMessage('❌ 저장에 실패했습니다.');
    }
  };

  const showMessage = (message: string) => {
    setSaveMessage(message);
    setTimeout(() => setSaveMessage(''), 3000);
  };

  const handleTeleport = () => {
    setIsSimulating(true);
    setSimulatedOffset(prev => prev + 0.001);
  };

  const handleResetLocation = () => {
    setIsSimulating(false);
    setSimulatedOffset(0);
    alertedMemoriesRef.current.clear();
  };

  const initialRegion: Region = {
    latitude: currentLat,
    longitude: currentLon,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  };

  // #region agent log
  debugLog('MapScreen.tsx:render', 'MapScreen rendering', { platform: Platform.OS }, 'B');
  // #endregion

  return (
    <View style={styles.container}>
      {/* 지도 영역 (상단 45%) */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={initialRegion}
          showsUserLocation={!isSimulating}
          showsMyLocationButton={true}
          showsCompass={true}
        >
          {/* 시뮬레이션 모드일 때 가상 위치 마커 */}
          {isSimulating && (
            <Marker
              coordinate={{ latitude: currentLat, longitude: currentLon }}
              title="시뮬레이션 위치"
              pinColor="blue"
            />
          )}
          
          {/* 메모리 마커들 */}
          {memories.map((memory) => {
            const distance = getDistanceFromLatLonInMeters(
              currentLat,
              currentLon,
              memory.latitude,
              memory.longitude
            );
            const isUnlocked = distance < PROXIMITY_THRESHOLD;

            return (
              <Marker
                key={memory.id}
                coordinate={{ latitude: memory.latitude, longitude: memory.longitude }}
                title={isUnlocked ? memory.text : '🔒 Locked'}
                description={formatDistance(distance)}
                pinColor={isUnlocked ? '#f59e0b' : '#9ca3af'}
              />
            );
          })}
        </MapView>

        {/* 시뮬레이션 배지 */}
        {isSimulating && (
          <View style={styles.simulationBadge}>
            <Text style={styles.simulationBadgeText}>🎮 SIMULATION</Text>
          </View>
        )}
      </View>

      {/* 하단 콘텐츠 영역 */}
      <ScrollView style={styles.bottomContainer} contentContainerStyle={styles.bottomContent}>
        {/* 디버그 버튼 */}
        <View style={styles.debugButtonContainer}>
          <TouchableOpacity style={styles.teleportButton} onPress={handleTeleport}>
            <Text style={styles.teleportButtonText}>🚀 Teleport</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.resetButton} onPress={handleResetLocation}>
            <Text style={styles.resetButtonText}>📍 Reset</Text>
          </TouchableOpacity>
        </View>

        {/* 입력 영역 */}
        <View style={styles.inputSection}>
          <TextInput
            style={styles.stickyNoteInput}
            placeholder="Leave a memory here..."
            placeholderTextColor="#a89f6a"
            value={memoryText}
            onChangeText={setMemoryText}
            multiline
            numberOfLines={2}
          />
          <TouchableOpacity style={styles.saveButton} onPress={handleSaveMemory}>
            <Text style={styles.saveButtonIcon}>📌</Text>
            <Text style={styles.saveButtonText}>Stick Memory</Text>
          </TouchableOpacity>
          {saveMessage ? <Text style={styles.saveMessage}>{saveMessage}</Text> : null}
        </View>

        {/* 메모리 리스트 */}
        <View style={styles.memorySection}>
          <Text style={styles.sectionTitle}>📋 저장된 메모리 ({memories.length}개)</Text>
          {memories.length === 0 ? (
            <Text style={styles.emptyText}>아직 저장된 메모리가 없습니다.</Text>
          ) : (
            memories.map((memory) => {
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
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusIcon}>{isUnlocked ? '🔓' : '🔒'}</Text>
                    <Text style={[styles.distanceText, isUnlocked ? styles.distanceUnlocked : styles.distanceLocked]}>
                      {formatDistance(distance)}
                    </Text>
                  </View>
                  {isUnlocked ? (
                    <Text style={styles.memoryText}>📝 {memory.text}</Text>
                  ) : (
                    <Text style={styles.memoryTextLocked}>🔒 Visit this location to unlock memory.</Text>
                  )}
                  <Text style={styles.memoryDate}>🕐 {memory.date}</Text>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  // 지도 영역
  mapContainer: {
    height: SCREEN_HEIGHT * 0.45,
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  simulationBadge: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    backgroundColor: '#ef4444',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  simulationBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  // 하단 콘텐츠
  bottomContainer: {
    flex: 1,
  },
  bottomContent: {
    padding: 16,
    paddingBottom: 40,
  },
  debugButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 16,
  },
  teleportButton: {
    backgroundColor: '#8b5cf6',
    paddingVertical: 8,
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
    paddingVertical: 8,
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
  // 입력 영역
  inputSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  stickyNoteInput: {
    width: '100%',
    minHeight: 80,
    backgroundColor: '#FFF7D6',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#5a5230',
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#e8dfa3',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f59e0b',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 25,
    marginTop: 12,
  },
  saveButtonIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  saveMessage: {
    marginTop: 10,
    fontSize: 14,
    color: '#10b981',
    fontWeight: '600',
  },
  // 메모리 리스트
  memorySection: {
    borderTopWidth: 1,
    borderTopColor: '#333355',
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 12,
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
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
  },
  memoryCardUnlocked: {
    backgroundColor: '#FFF9C4',
    borderLeftColor: '#f59e0b',
  },
  memoryCardLocked: {
    backgroundColor: '#3a3a5e',
    borderLeftColor: '#666680',
    opacity: 0.8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  statusIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  distanceText: {
    fontSize: 12,
    fontWeight: '600',
  },
  distanceUnlocked: {
    color: '#d97706',
  },
  distanceLocked: {
    color: '#888888',
  },
  memoryText: {
    fontSize: 15,
    marginBottom: 6,
    lineHeight: 20,
    color: '#5a5230',
  },
  memoryTextLocked: {
    fontSize: 14,
    color: '#888888',
    fontStyle: 'italic',
    marginBottom: 6,
  },
  memoryDate: {
    fontSize: 11,
    color: '#666666',
  },
});
