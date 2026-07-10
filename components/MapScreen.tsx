import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView, Platform, Alert, Dimensions, ActivityIndicator, ImageBackground, Image } from 'react-native';
import MapView, { Region, Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { LocationObject } from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts, NanumPenScript_400Regular } from '@expo-google-fonts/nanum-pen-script';

// 지오펜싱 서비스
import { 
  registerGeofenceForMemory, 
  unregisterGeofenceForMemory,
  GEOFENCE_RADIUS,
  GEOFENCE_RADIUS_OPTIONS,
  GeofenceRadius,
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
type MemoryVisibility = 'private' | 'public';

interface Memory {
  id: string;
  text: string;
  latitude: number;
  longitude: number;
  date: string;
  color: string;
  rotation: number;
  isImportant: boolean;
  notificationRadius?: GeofenceRadius;
  imageUri?: string;
  visibility: MemoryVisibility;
  duration?: number; // hours
  expiresAt?: number; // timestamp (ms)
  author: string;
  isMine: boolean;
}

// 앱 모드
type AppMode = 'diary' | 'exploration';

// Mock 작성자 닉네임
const MOCK_AUTHORS = ['CoffeeLover', 'Stranger', 'Walker', 'NightOwl', 'DreamChaser', 'Wanderer', 'StarGazer', 'BookWorm'];

// Mock 메시지
const MOCK_TEXTS = [
  '여기서 커피 한 잔 했는데 뷰가 최고였어요 ☕',
  '비 오는 날 이 길을 걸었는데 참 좋았어요 🌧️',
  '처음 와본 곳인데 다시 오고 싶다!',
  '친구랑 여기서 웃긴 사진 찍었어 📸',
  '이 벤치에서 책 읽기 딱 좋아요 📖',
  '산책하다가 발견한 숨은 맛집! 🍜',
  '노을이 정말 예뻤던 곳 🌅',
  '여기 분위기 너무 좋다...',
  '오늘 하루도 수고했어, 나 자신 💪',
  '이 골목 진짜 포토존이야!',
];

// Mock 메모리 생성기 (500m 반경)
function generateMockMemories(centerLat: number, centerLon: number): Memory[] {
  const count = 5 + Math.floor(Math.random() * 6); // 5~10개
  const mocks: Memory[] = [];
  for (let i = 0; i < count; i++) {
    // 500m ≈ 0.0045 degree
    const offsetLat = (Math.random() - 0.5) * 0.009;
    const offsetLon = (Math.random() - 0.5) * 0.009;
    const hoursLeft = [1, 6, 12, 24, 48, 72, 120, 168][Math.floor(Math.random() * 8)];
    mocks.push({
      id: `mock-${Date.now()}-${i}`,
      text: MOCK_TEXTS[Math.floor(Math.random() * MOCK_TEXTS.length)],
      latitude: centerLat + offsetLat,
      longitude: centerLon + offsetLon,
      date: new Date(Date.now() - Math.random() * 86400000 * 3).toLocaleString('ko-KR'),
      color: getRandomColor(),
      rotation: getRandomRotation(),
      isImportant: false,
      visibility: 'public',
      duration: hoursLeft,
      expiresAt: Date.now() + hoursLeft * 60 * 60 * 1000,
      author: MOCK_AUTHORS[Math.floor(Math.random() * MOCK_AUTHORS.length)],
      isMine: false,
    });
  }
  return mocks;
}

// Duration 옵션
const DURATION_OPTIONS = [
  { label: '24시간', hours: 24 },
  { label: '3일', hours: 72 },
  { label: '7일', hours: 168 },
];

// 남은 시간 포맷
function formatRemainingTime(expiresAt: number): string {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return '만료됨';
  const hours = Math.floor(remaining / (1000 * 60 * 60));
  if (hours < 1) {
    const minutes = Math.floor(remaining / (1000 * 60));
    return `${minutes}m left`;
  }
  if (hours < 24) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  return `D-${days}`;
}

// 만료된 Public 메모리 정리
async function cleanupExpiredMemories(storageKey: string): Promise<Memory[]> {
  try {
    const stored = await AsyncStorage.getItem(storageKey);
    if (!stored) return [];
    const all: Memory[] = JSON.parse(stored);
    const now = Date.now();
    const active = all.filter(m => {
      if (m.visibility === 'public' && m.expiresAt && now > m.expiresAt) return false;
      return true;
    });
    if (active.length !== all.length) {
      await AsyncStorage.setItem(storageKey, JSON.stringify(active));
    }
    return active;
  } catch (_e) {
    return [];
  }
}

const STORAGE_KEY = '@memories';
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function getMemoryRadius(memory: Memory): GeofenceRadius {
  return GEOFENCE_RADIUS_OPTIONS.includes(memory.notificationRadius as GeofenceRadius)
    ? memory.notificationRadius as GeofenceRadius
    : GEOFENCE_RADIUS;
}

async function persistMemoryImage(imageUri: string | undefined, memoryId: string): Promise<string | undefined> {
  if (!imageUri || !FileSystem.documentDirectory) return imageUri;

  const imageDirectory = `${FileSystem.documentDirectory}memory-images/`;
  const uriWithoutQuery = imageUri.split('?')[0];
  const extensionMatch = uriWithoutQuery.match(/\.([a-zA-Z0-9]+)$/);
  const extension = extensionMatch?.[1]?.toLowerCase() || 'jpg';
  const destination = `${imageDirectory}${memoryId}.${extension}`;

  await FileSystem.makeDirectoryAsync(imageDirectory, { intermediates: true });
  await FileSystem.copyAsync({ from: imageUri, to: destination });
  return destination;
}

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
  const [selectedImageUri, setSelectedImageUri] = useState<string | undefined>();
  const [selectedRadius, setSelectedRadius] = useState<GeofenceRadius>(GEOFENCE_RADIUS);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [saveMessage, setSaveMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
  // Visibility & Duration 상태
  const [selectedVisibility, setSelectedVisibility] = useState<MemoryVisibility>('private');
  const [selectedDuration, setSelectedDuration] = useState<number>(24); // hours
  
  // 앱 모드 (My Diary vs Exploration)
  const [appMode, setAppMode] = useState<AppMode>('diary');
  const [nearbyMemories, setNearbyMemories] = useState<Memory[]>([]);
  
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

      if (distance < getMemoryRadius(memory) && !alertedMemoriesRef.current.has(memory.id)) {
        Alert.alert(
          '🎉 Memory Found!',
          `"${memory.text}"\n\nSaved on: ${memory.date}`,
          [{ text: 'OK' }]
        );
        alertedMemoriesRef.current.add(memory.id);
        debugLog('MapScreen.tsx:geofence', 'Memory unlocked!', { memoryId: memory.id, distance }, 'A');
      } else if (distance >= getMemoryRadius(memory)) {
        alertedMemoriesRef.current.delete(memory.id);
      }
    });
  }, [location, memories, simulatedOffset]);

  const loadMemories = async () => {
    try {
      // 만료된 public 메모리 정리 후 로드
      const active = await cleanupExpiredMemories(STORAGE_KEY);
      const migrated = active.map((m: Memory) => ({
        ...m,
        color: m.color || getRandomColor(),
        rotation: m.rotation !== undefined ? m.rotation : getRandomRotation(),
        isImportant: m.isImportant ?? false,
        notificationRadius: getMemoryRadius(m),
        visibility: m.visibility ?? 'private',
        author: m.author ?? 'Me',
        isMine: m.isMine ?? true,
      }));
      setMemories(migrated);
    } catch (error) {
      console.error('메모리 불러오기 실패:', error);
    }
  };

  const handleSaveMemory = async () => {
    if (!memoryText.trim()) {
      showMessage('✏️ 메모리 내용을 입력해주세요.');
      return;
    }

    setIsSaving(true);
    showMessage('📍 현재 위치를 가져오는 중...');

    try {
      // 버튼 클릭 시점의 정확한 현재 위치를 가져옴
      const freshLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      if (!freshLocation || !freshLocation.coords) {
        showMessage('❌ 위치 정보를 찾을 수 없습니다.');
        setIsSaving(false);
        return;
      }

      const isPublic = selectedVisibility === 'public';
      const memoryId = Date.now().toString();
      const persistentImageUri = await persistMemoryImage(selectedImageUri, memoryId);
      const newMemory: Memory = {
        id: memoryId,
        text: memoryText.trim(),
        latitude: freshLocation.coords.latitude,
        longitude: freshLocation.coords.longitude,
        date: new Date().toLocaleString('ko-KR'),
        color: getRandomColor(),
        rotation: getRandomRotation(),
        isImportant: false,
        notificationRadius: selectedRadius,
        imageUri: persistentImageUri,
        visibility: selectedVisibility,
        duration: isPublic ? selectedDuration : undefined,
        expiresAt: isPublic ? Date.now() + selectedDuration * 60 * 60 * 1000 : undefined,
        author: 'Me',
        isMine: true,
      };

      const updatedMemories = [...memories, newMemory];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
      setMemories(updatedMemories);
      setMemoryText('');
      setSelectedImageUri(undefined);
      setSelectedRadius(GEOFENCE_RADIUS);
      setSelectedVisibility('private');
      setSelectedDuration(24);
      
      // 지오펜스 등록 (백그라운드 알림용)
      if (backgroundPermissionGranted) {
        await registerGeofenceForMemory(newMemory);
        showMessage('✨ Memory Saved! (알림 활성화)');
        console.log(`📍 [MapScreen] Geofence registered for memory ${newMemory.id} at radius ${newMemory.notificationRadius}m`);
      } else {
        showMessage('✨ Memory Saved!');
      }
      
      debugLog('MapScreen.tsx:saveMemory', 'Memory saved', { memory: newMemory, freshLocation: freshLocation.coords, geofenceRegistered: backgroundPermissionGranted }, 'A');
    } catch (error) {
      console.error('메모리 저장 실패:', error);
      showMessage('❌ 저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const showMessage = (message: string) => {
    setSaveMessage(message);
    setTimeout(() => setSaveMessage(''), 3000);
  };

  const handlePickImage = async () => {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('사진 권한 필요', '메모에 사진을 첨부하려면 사진 접근 권한이 필요합니다.');
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setSelectedImageUri(result.assets[0].uri);
    }
  };

  const handleToggleImportant = async (memoryId: string) => {
    const updatedMemories = memories.map(memory =>
      memory.id === memoryId ? { ...memory, isImportant: !memory.isImportant } : memory
    );
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
    setMemories(updatedMemories);
  };

  const deleteMemory = async (memoryId: string) => {
    const memoryToDelete = memories.find(memory => memory.id === memoryId);
    const updatedMemories = memories.filter(memory => memory.id !== memoryId);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
    setMemories(updatedMemories);
    alertedMemoriesRef.current.delete(memoryId);
    await unregisterGeofenceForMemory(memoryId);

    if (FileSystem.documentDirectory && memoryToDelete?.imageUri?.startsWith(FileSystem.documentDirectory)) {
      await FileSystem.deleteAsync(memoryToDelete.imageUri, { idempotent: true });
    }
  };

  const handleDeleteMemory = (memoryId: string) => {
    Alert.alert('메모 삭제', '이 위치 메모를 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          deleteMemory(memoryId).catch(() => {
            Alert.alert('삭제 실패', '메모를 삭제하지 못했습니다. 다시 시도해주세요.');
          });
        },
      },
    ]);
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

  // Mock 데이터 로드
  const handleLoadNearby = () => {
    const mocks = generateMockMemories(currentLat, currentLon);
    setNearbyMemories(mocks);
    showMessage(`🔄 ${mocks.length}개의 주변 노트를 발견했어요!`);
  };

  // 모드에 따른 필터링
  const displayMemories = appMode === 'diary'
    ? memories.filter(m => m.isMine)
    : [...nearbyMemories, ...memories.filter(m => !m.isMine && m.visibility === 'public')];

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
      {/* 모드 토글 */}
      <View style={styles.modeToggle}>
        <TouchableOpacity
          style={[styles.modeBtn, appMode === 'diary' && styles.modeBtnActive]}
          onPress={() => setAppMode('diary')}
        >
          <Text style={[styles.modeBtnText, appMode === 'diary' && styles.modeBtnTextActive]}>
            📔 My Diary
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, appMode === 'exploration' && styles.modeBtnActiveExplore]}
          onPress={() => setAppMode('exploration')}
        >
          <Text style={[styles.modeBtnText, appMode === 'exploration' && styles.modeBtnTextActive]}>
            🌍 Exploration
          </Text>
        </TouchableOpacity>
        {appMode === 'exploration' && (
          <TouchableOpacity style={styles.loadNearbyBtn} onPress={handleLoadNearby}>
            <Text style={styles.loadNearbyText}>🔄</Text>
          </TouchableOpacity>
        )}
      </View>

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
          
          {displayMemories.map((memory) => {
            const distance = getDistanceFromLatLonInMeters(
              currentLat,
              currentLon,
              memory.latitude,
              memory.longitude
            );
            const isUnlocked = distance < getMemoryRadius(memory);
            const isOthers = !memory.isMine;
            const timerLabel = memory.visibility === 'public' && memory.expiresAt ? ` ⏳${formatRemainingTime(memory.expiresAt)}` : '';
            const authorLabel = isOthers ? ` by ${memory.author}` : '';

            return (
              <Marker
                key={memory.id}
                coordinate={{ latitude: memory.latitude, longitude: memory.longitude }}
                title={isUnlocked ? memory.text : '🔒 Locked'}
                description={`${formatDistance(distance)} away${timerLabel}${authorLabel}`}
                pinColor={isOthers ? '#3498db' : (isUnlocked ? '#f59e0b' : '#9ca3af')}
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
        {/* 입력 영역 (Diary 모드에서만) */}
        {appMode === 'diary' && <View style={styles.inputSection}>
          <TextInput
            style={styles.stickyNoteInput}
            placeholder="Leave a memory here..."
            placeholderTextColor="#a89f6a"
            value={memoryText}
            onChangeText={setMemoryText}
            multiline
            numberOfLines={2}
          />

          {selectedImageUri ? (
            <View style={styles.imagePreviewContainer}>
              <Image source={{ uri: selectedImageUri }} style={styles.imagePreview} />
              <TouchableOpacity style={styles.removeImageButton} onPress={() => setSelectedImageUri(undefined)}>
                <Text style={styles.removeImageButtonText}>사진 삭제</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.attachImageButton} onPress={handlePickImage}>
              <Text style={styles.attachImageButtonText}>사진 1장 첨부</Text>
            </TouchableOpacity>
          )}

          {/* Visibility 토글 */}
          <View style={styles.visibilityToggle}>
            <TouchableOpacity
              style={[styles.visibilityBtn, selectedVisibility === 'private' && styles.visibilityBtnActive]}
              onPress={() => setSelectedVisibility('private')}
            >
              <Text style={[styles.visibilityBtnText, selectedVisibility === 'private' && styles.visibilityBtnTextActive]}>
                🔒 Private
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.visibilityBtn, selectedVisibility === 'public' && styles.visibilityBtnActivePublic]}
              onPress={() => setSelectedVisibility('public')}
            >
              <Text style={[styles.visibilityBtnText, selectedVisibility === 'public' && styles.visibilityBtnTextActive]}>
                📢 Public
              </Text>
            </TouchableOpacity>
          </View>

          {/* Duration 선택 (Public일 때만) */}
          {selectedVisibility === 'public' && (
            <View style={styles.durationRow}>
              <Text style={styles.durationLabel}>⏳ 유효기간:</Text>
              <View style={styles.durationButtons}>
                {DURATION_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.hours}
                    style={[styles.durationBtn, selectedDuration === opt.hours && styles.durationBtnActive]}
                    onPress={() => setSelectedDuration(opt.hours)}
                  >
                    <Text style={[styles.durationBtnText, selectedDuration === opt.hours && styles.durationBtnTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <View style={styles.radiusSection}>
            <Text style={styles.radiusLabel}>도착 알림 반경</Text>
            <View style={styles.radiusButtons}>
              {GEOFENCE_RADIUS_OPTIONS.map(radius => (
                <TouchableOpacity
                  key={radius}
                  style={[styles.radiusButton, selectedRadius === radius && styles.radiusButtonActive]}
                  onPress={() => setSelectedRadius(radius)}
                >
                  <Text style={[styles.radiusButtonText, selectedRadius === radius && styles.radiusButtonTextActive]}>
                    {radius}m
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity 
            style={[styles.saveButton, isSaving && styles.saveButtonDisabled]} 
            onPress={handleSaveMemory}
            disabled={isSaving}
          >
            {isSaving ? (
              <View style={styles.savingContainer}>
                <ActivityIndicator size="small" color="#FFF" />
                <Text style={styles.saveButtonText}> Saving...</Text>
              </View>
            ) : (
              <Text style={styles.saveButtonText}>📌 Stick Memory</Text>
            )}
          </TouchableOpacity>
          {saveMessage ? <Text style={styles.saveMessage}>{saveMessage}</Text> : null}
        </View>}

        {/* Exploration 모드 안내 */}
        {appMode === 'exploration' && (
          <View style={styles.explorationHeader}>
            <Text style={styles.explorationTitle}>🌍 주변 사람들의 추억</Text>
            <TouchableOpacity style={styles.loadNearbyBtnLarge} onPress={handleLoadNearby}>
              <Text style={styles.loadNearbyBtnText}>🔄 Load Nearby Notes</Text>
            </TouchableOpacity>
            {saveMessage ? <Text style={styles.saveMessage}>{saveMessage}</Text> : null}
          </View>
        )}

        {/* Sticky Note Wall */}
        <View style={styles.corkboard}>
          <Text style={styles.wallTitle}>
            {appMode === 'diary' ? `📔 My Memories (${displayMemories.length})` : `🌍 Nearby Notes (${displayMemories.length})`}
          </Text>
          
          {displayMemories.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyText}>아직 추억이 없습니다</Text>
            </View>
          ) : (
            <View style={styles.notesGrid}>
              {displayMemories.map((memory) => {
                const distance = getDistanceFromLatLonInMeters(
                  currentLat,
                  currentLon,
                  memory.latitude,
                  memory.longitude
                );
                const isUnlocked = distance < getMemoryRadius(memory);
                const isPublic = memory.visibility === 'public';

                return (
                  <View
                    key={memory.id}
                    style={[
                      styles.stickyNote,
                      {
                        backgroundColor: isUnlocked ? memory.color : '#E0E0E0',
                        transform: [{ rotate: `${memory.rotation}deg` }],
                      },
                      isPublic && styles.stickyNotePublic,
                    ]}
                  >
                    <View style={styles.pinContainer}>
                      <Text style={styles.pinIcon}>{memory.isImportant ? '📍' : '📌'}</Text>
                    </View>

                    {memory.isMine && (
                      <View style={styles.noteActions}>
                        <TouchableOpacity style={styles.noteActionButton} onPress={() => handleToggleImportant(memory.id)}>
                          <Text style={styles.noteActionText}>{memory.isImportant ? '★' : '☆'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.noteActionButton} onPress={() => handleDeleteMemory(memory.id)}>
                          <Text style={styles.noteActionText}>×</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Visibility 뱃지 */}
                    <View style={[styles.visibilityBadge, isPublic ? styles.visibilityBadgePublic : styles.visibilityBadgePrivate]}>
                      <Text style={styles.visibilityBadgeText}>
                        {isPublic ? '📢' : '🔒'}
                      </Text>
                    </View>

                    {/* Public 타이머 뱃지 */}
                    {isPublic && memory.expiresAt && (
                      <View style={styles.timerBadge}>
                        <Text style={styles.timerBadgeText}>
                          ⏳ {formatRemainingTime(memory.expiresAt)}
                        </Text>
                      </View>
                    )}

                    {!isUnlocked && !isPublic && (
                      <View style={styles.lockSticker}>
                        <Text style={styles.lockIcon}>🔒</Text>
                      </View>
                    )}

                    <View style={styles.noteContent}>
                      {isUnlocked ? (
                        <>
                          {memory.imageUri && <Image source={{ uri: memory.imageUri }} style={styles.noteImage} />}
                          <Text style={styles.noteText} numberOfLines={memory.imageUri ? 2 : 3}>
                            {memory.text}
                          </Text>
                        </>
                      ) : (
                        <Text style={styles.lockedText}>Visit to unlock!</Text>
                      )}
                    </View>

                    <View style={styles.noteFooter}>
                      <Text style={styles.distanceBadge}>📍 {formatDistance(distance)}</Text>
                      <Text style={styles.radiusBadge}>알림 {getMemoryRadius(memory)}m</Text>
                      {!memory.isMine && (
                        <Text style={styles.authorBadge}>by {memory.author}</Text>
                      )}
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
  // 모드 토글
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: '#3C1E0A',
    paddingTop: 50,
    paddingBottom: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginHorizontal: 4,
  },
  modeBtnActive: {
    backgroundColor: '#E67E22',
  },
  modeBtnActiveExplore: {
    backgroundColor: '#3498db',
  },
  modeBtnText: {
    fontSize: 15,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#DEB887',
  },
  modeBtnTextActive: {
    color: '#FFF',
  },
  loadNearbyBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  loadNearbyText: {
    fontSize: 18,
  },
  // Exploration 헤더
  explorationHeader: {
    margin: 12,
    padding: 16,
    backgroundColor: '#D6EAF8',
    borderRadius: 4,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  explorationTitle: {
    fontSize: 20,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#2C3E50',
    marginBottom: 8,
  },
  loadNearbyBtnLarge: {
    backgroundColor: '#3498db',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
  },
  loadNearbyBtnText: {
    fontSize: 16,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#FFF',
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
  attachImageButton: {
    marginTop: 10,
    minHeight: 42,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#8B4513',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  attachImageButtonText: {
    color: '#5D3A1A',
    fontSize: 16,
    fontFamily: 'NanumPenScript_400Regular',
  },
  imagePreviewContainer: {
    marginTop: 10,
  },
  imagePreview: {
    width: '100%',
    height: 140,
    borderRadius: 4,
  },
  removeImageButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 4,
  },
  removeImageButtonText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
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
  saveButtonDisabled: {
    backgroundColor: '#BDC3C7',
  },
  savingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
  // Visibility 토글
  visibilityToggle: {
    flexDirection: 'row',
    marginTop: 12,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#DEB887',
  },
  visibilityBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  visibilityBtnActive: {
    backgroundColor: '#8B4513',
  },
  visibilityBtnActivePublic: {
    backgroundColor: '#3498db',
  },
  visibilityBtnText: {
    fontSize: 16,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#5D3A1A',
  },
  visibilityBtnTextActive: {
    color: '#FFF',
  },
  // Duration 선택
  durationRow: {
    marginTop: 10,
    alignItems: 'center',
  },
  durationLabel: {
    fontSize: 15,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#5D3A1A',
    marginBottom: 6,
  },
  durationButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  durationBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderWidth: 1,
    borderColor: '#DEB887',
  },
  durationBtnActive: {
    backgroundColor: '#3498db',
    borderColor: '#3498db',
  },
  durationBtnText: {
    fontSize: 14,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#5D3A1A',
  },
  durationBtnTextActive: {
    color: '#FFF',
  },
  radiusSection: {
    marginTop: 12,
  },
  radiusLabel: {
    marginBottom: 6,
    color: '#5D3A1A',
    fontSize: 15,
    fontFamily: 'NanumPenScript_400Regular',
    textAlign: 'center',
  },
  radiusButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  radiusButton: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderColor: '#DEB887',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  radiusButtonActive: {
    backgroundColor: '#E67E22',
    borderColor: '#E67E22',
  },
  radiusButtonText: {
    color: '#5D3A1A',
    fontSize: 14,
    fontWeight: '600',
  },
  radiusButtonTextActive: {
    color: '#FFF',
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
  noteActions: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 12,
    flexDirection: 'row',
    gap: 4,
  },
  noteActionButton: {
    width: 28,
    height: 28,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.82)',
  },
  noteActionText: {
    color: '#5D3A1A',
    fontSize: 18,
    fontWeight: '700',
  },
  stickyNotePublic: {
    borderLeftWidth: 3,
    borderLeftColor: '#3498db',
  },
  // Visibility 뱃지
  visibilityBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },
  visibilityBadgePublic: {
    backgroundColor: '#D6EAF8',
  },
  visibilityBadgePrivate: {
    backgroundColor: '#FADBD8',
  },
  visibilityBadgeText: {
    fontSize: 10,
  },
  // 타이머 뱃지
  timerBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(52,152,219,0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    elevation: 2,
  },
  timerBadgeText: {
    fontSize: 9,
    color: '#FFF',
    fontWeight: '600',
  },
  lockSticker: {
    position: 'absolute',
    top: 38,
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
  noteImage: {
    width: '100%',
    height: 58,
    borderRadius: 3,
    marginBottom: 4,
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
  radiusBadge: {
    marginTop: 3,
    fontSize: 9,
    color: '#5D3A1A',
  },
  authorBadge: {
    fontSize: 9,
    color: '#3498db',
    fontWeight: '600',
    marginTop: 2,
    alignSelf: 'flex-end',
  },
});
