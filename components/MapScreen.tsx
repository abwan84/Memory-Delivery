import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView, Platform, Alert, Dimensions, ActivityIndicator, ImageBackground } from 'react-native';
import MapView, { Region, Marker } from 'react-native-maps';
import { LocationObject } from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts, NanumPenScript_400Regular } from '@expo-google-fonts/nanum-pen-script';

// 지오펜싱 서비스
import { 
  registerGeofenceForMemory, 
  unregisterGeofenceForMemory,
  GEOFENCE_RADIUS 
} from '../services/GeofencingService';

// 코르크보드 배경 이미지
const corkboardBg = require('../assets/corkboard-bg.jpg');

// #region agent log
const debugLog = (location: string, message: string, data: object, hypothesisId: string) => {
  fetch('http://127.0.0.1:7242/ingest/0595a1ca-db13-40a1-91db-65b59f7fff34',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location,message,data,timestamp:Date.now(),sessionId:'debug-session',hypothesisId})}).catch(()=>{});
};
// #endregion

// ============================================
// 파스텔 색상 팔레트 & 헬퍼 함수
// ============================================
const PASTEL_COLORS = [
  '#FFF7D1', // Yellow
  '#FFD1DC', // Pink
  '#D1EAFF', // Blue
  '#D1FFD6', // Green
  '#E8D1FF', // Purple
  '#FFE4D1', // Peach
];

function getRandomColor(): string {
  return PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)];
}

function getRandomRotation(): number {
  return Math.random() * 10 - 5;
}

// Memory 데이터 타입 정의
interface Memory {
  id: string;
  text: string;
  latitude: number;
  longitude: number;
  date: string;
  color: string;
  rotation: number;
  isImportant: boolean;
}

const STORAGE_KEY = '@memories';
const PROXIMITY_THRESHOLD = 50;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Haversine 공식
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
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

interface MapScreenProps {
  location: LocationObject;
  backgroundPermissionGranted?: boolean;
}

export default function MapScreen({ location, backgroundPermissionGranted }: MapScreenProps) {
  // 나눔손글씨 폰트 로드
  const [fontsLoaded] = useFonts({
    NanumPenScript_400Regular,
  });

  const [memoryText, setMemoryText] = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [saveMessage, setSaveMessage] = useState('');
  
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedOffset, setSimulatedOffset] = useState(0);
  
  const alertedMemoriesRef = useRef<Set<string>>(new Set());
  const mapRef = useRef<MapView>(null);

  const currentLat = location.coords.latitude + simulatedOffset;
  const currentLon = location.coords.longitude;

  // #region agent log
  useEffect(() => {
    debugLog('MapScreen.tsx:mount', 'MapScreen mounted', { lat: location?.coords?.latitude, lng: location?.coords?.longitude }, 'A');
  }, []);
  // #endregion

  useEffect(() => {
    loadMemories();
  }, []);

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
        const parsed = JSON.parse(storedMemories);
        const migrated = parsed.map((m: Memory) => ({
          ...m,
          color: m.color || getRandomColor(),
          rotation: m.rotation !== undefined ? m.rotation : getRandomRotation(),
          isImportant: m.isImportant ?? false,
        }));
        setMemories(migrated);
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
        color: getRandomColor(),
        rotation: getRandomRotation(),
        isImportant: false,
      };

      const updatedMemories = [...memories, newMemory];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
      setMemories(updatedMemories);
      setMemoryText('');
      
      // 지오펜스 등록 (백그라운드 알림용)
      if (backgroundPermissionGranted) {
        await registerGeofenceForMemory(newMemory);
        showMessage('✨ Memory Saved! (알림 활성화)');
        console.log(`📍 [MapScreen] Geofence registered for memory ${newMemory.id} at radius ${GEOFENCE_RADIUS}m`);
      } else {
        showMessage('✨ Memory Saved!');
      }
      
      debugLog('MapScreen.tsx:saveMemory', 'Memory saved', { memory: newMemory, geofenceRegistered: backgroundPermissionGranted }, 'A');
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

  // 폰트 로딩 중
  if (!fontsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8B4513" />
        <Text style={styles.loadingText}>Loading fonts...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 지도 영역 */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={initialRegion}
          showsUserLocation={!isSimulating}
          showsMyLocationButton={true}
          showsCompass={true}
        >
          {isSimulating && (
            <Marker
              coordinate={{ latitude: currentLat, longitude: currentLon }}
              title="시뮬레이션 위치"
              pinColor="blue"
            />
          )}
          
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
                description={`${formatDistance(distance)} away`}
                pinColor={isUnlocked ? '#f59e0b' : '#9ca3af'}
              />
            );
          })}
        </MapView>

        {isSimulating && (
          <View style={styles.simulationBadge}>
            <Text style={styles.simulationBadgeText}>🎮 SIMULATION</Text>
          </View>
        )}

        {/* 디버그 버튼 */}
        <View style={styles.mapButtonContainer}>
          <TouchableOpacity style={styles.mapButton} onPress={handleTeleport}>
            <Text style={styles.mapButtonText}>🚀</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.mapButton} onPress={handleResetLocation}>
            <Text style={styles.mapButtonText}>📍</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 하단 스티키 노트 월 */}
      <ImageBackground source={corkboardBg} style={styles.bottomContainer} resizeMode="cover">
        <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.bottomContent}>
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
            <Text style={styles.saveButtonText}>📌 Stick Memory</Text>
          </TouchableOpacity>
          {saveMessage ? <Text style={styles.saveMessage}>{saveMessage}</Text> : null}
        </View>

        {/* Sticky Note Wall */}
        <View style={styles.corkboard}>
          <Text style={styles.wallTitle}>🗒️ Memory Wall ({memories.length})</Text>
          
          {memories.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyText}>아직 추억이 없습니다</Text>
            </View>
          ) : (
            <View style={styles.notesGrid}>
              {memories.map((memory) => {
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
                      styles.stickyNote,
                      {
                        backgroundColor: isUnlocked ? memory.color : '#E0E0E0',
                        transform: [{ rotate: `${memory.rotation}deg` }],
                      },
                    ]}
                  >
                    <View style={styles.pinContainer}>
                      <Text style={styles.pinIcon}>📌</Text>
                    </View>

                    {!isUnlocked && (
                      <View style={styles.lockSticker}>
                        <Text style={styles.lockIcon}>🔒</Text>
                      </View>
                    )}

                    <View style={styles.noteContent}>
                      {isUnlocked ? (
                        <Text style={styles.noteText} numberOfLines={3}>
                          {memory.text}
                        </Text>
                      ) : (
                        <Text style={styles.lockedText}>Visit to unlock!</Text>
                      )}
                    </View>

                    <View style={styles.noteFooter}>
                      <Text style={styles.distanceBadge}>📍 {formatDistance(distance)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
        </ScrollView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  // 로딩 화면
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#D4A574',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#5D3A1A',
  },
  container: {
    flex: 1,
    backgroundColor: '#D4A574',
  },
  // 지도 영역
  mapContainer: {
    height: SCREEN_HEIGHT * 0.35,
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
  mapButtonContainer: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    gap: 8,
  },
  mapButton: {
    backgroundColor: '#8B4513',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  mapButtonText: {
    fontSize: 20,
  },
  // 하단 콘텐츠
  bottomContainer: {
    flex: 1,
  },
  scrollContainer: {
    flex: 1,
  },
  bottomContent: {
    paddingBottom: 40,
  },
  // 입력 영역
  inputSection: {
    margin: 12,
    padding: 16,
    backgroundColor: '#FFF7D1',
    borderRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    transform: [{ rotate: '-1deg' }],
  },
  stickyNoteInput: {
    minHeight: 60,
    backgroundColor: '#FFFEF5',
    borderRadius: 4,
    padding: 12,
    fontSize: 18,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#333',
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#E8DFA3',
  },
  saveButton: {
    backgroundColor: '#E67E22',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
    marginTop: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  saveButtonText: {
    fontSize: 18,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#FFF',
  },
  saveMessage: {
    marginTop: 8,
    fontSize: 14,
    color: '#27AE60',
    fontWeight: '600',
    textAlign: 'center',
  },
  // 코르크보드
  corkboard: {
    flex: 1,
    padding: 12,
  },
  wallTitle: {
    fontSize: 24,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#5D3A1A',
    textAlign: 'center',
    marginBottom: 16,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyIcon: {
    fontSize: 50,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 20,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#5D3A1A',
  },
  // 그리드
  notesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  // 스티키 노트
  stickyNote: {
    width: '47%',
    aspectRatio: 1,
    padding: 10,
    borderRadius: 3,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  pinContainer: {
    position: 'absolute',
    top: -6,
    left: '50%',
    marginLeft: -8,
    zIndex: 10,
  },
  pinIcon: {
    fontSize: 16,
  },
  lockSticker: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: '#FF6B6B',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
  },
  lockIcon: {
    fontSize: 14,
  },
  noteContent: {
    flex: 1,
    marginTop: 12,
    justifyContent: 'center',
  },
  noteText: {
    fontSize: 16,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#333',
    lineHeight: 22,
  },
  lockedText: {
    fontSize: 14,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#888',
    textAlign: 'center',
  },
  noteFooter: {
    marginTop: 6,
  },
  distanceBadge: {
    fontSize: 10,
    color: '#666',
    backgroundColor: 'rgba(255,255,255,0.5)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
});
