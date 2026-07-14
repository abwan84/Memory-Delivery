import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView, Platform, Alert, Dimensions, ActivityIndicator, ImageBackground, Image, Switch } from 'react-native';
import MapView, { Region, Marker, MapPressEvent, PROVIDER_GOOGLE } from 'react-native-maps';
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
  sendArrivalNotification,
  claimForegroundArrivalNotifications,
  prepareMemoryNotificationState,
  GEOFENCE_RADIUS,
  GEOFENCE_RADIUS_OPTIONS,
  DEFAULT_NOTIFICATION_REPEAT_MODE,
  REENTRY_BUFFER_METERS,
  GeofenceRadius,
  NotificationRepeatMode,
} from '../services/GeofencingService';

// 코르크보드 배경 이미지
const corkboardBg = require('../assets/corkboard-bg.jpg');

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
type DraftLocationMode = 'current' | 'map';

interface DraftCoordinate {
  latitude: number;
  longitude: number;
}

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
  notificationRepeatMode?: NotificationRepeatMode;
  arrivalNotificationEnabled?: boolean;
  imageUri?: string;
  visibility: MemoryVisibility;
  duration?: number; // hours
  expiresAt?: number; // timestamp (ms)
  author: string;
  isMine: boolean;
  updatedAt?: string;
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

function isMemoryNearby(memory: Memory, distance: number): boolean {
  return distance < getMemoryRadius(memory);
}

function canReadMemory(memory: Memory, distance: number): boolean {
  return memory.visibility === 'private' || isMemoryNearby(memory, distance);
}

function canManageMemory(memory: Memory, distance: number): boolean {
  return memory.visibility === 'private' || isMemoryNearby(memory, distance);
}

function lightenHexColor(color: string, amount = 0.58): string {
  const hex = color.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '#F3EFE4';

  const channels = [0, 2, 4].map(index => {
    const value = parseInt(hex.slice(index, index + 2), 16);
    return Math.round(value + (255 - value) * amount)
      .toString(16)
      .padStart(2, '0');
  });

  return `#${channels.join('')}`;
}

function getMemoryCardColor(memory: Memory, isNearby: boolean): string {
  if (memory.visibility === 'public') {
    return isNearby ? memory.color : '#E0E0E0';
  }
  return isNearby ? memory.color : lightenHexColor(memory.color);
}

async function persistMemoryImage(imageUri: string | undefined, memoryId: string): Promise<string | undefined> {
  if (!imageUri || !FileSystem.documentDirectory) return imageUri;
  if (imageUri.startsWith(FileSystem.documentDirectory)) return imageUri;

  const imageDirectory = `${FileSystem.documentDirectory}memory-images/`;
  const uriWithoutQuery = imageUri.split('?')[0];
  const extensionMatch = uriWithoutQuery.match(/\.([a-zA-Z0-9]+)$/);
  const extension = extensionMatch?.[1]?.toLowerCase() || 'jpg';
  const destination = `${imageDirectory}${memoryId}.${extension}`;

  await FileSystem.makeDirectoryAsync(imageDirectory, { intermediates: true });
  await FileSystem.deleteAsync(destination, { idempotent: true });
  await FileSystem.copyAsync({ from: imageUri, to: destination });
  return destination;
}

async function deletePersistedMemoryImage(imageUri: string | undefined): Promise<void> {
  if (FileSystem.documentDirectory && imageUri?.startsWith(FileSystem.documentDirectory)) {
    await FileSystem.deleteAsync(imageUri, { idempotent: true });
  }
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
  const [selectedNotificationRepeatMode, setSelectedNotificationRepeatMode] =
    useState<NotificationRepeatMode>(DEFAULT_NOTIFICATION_REPEAT_MODE);
  const [arrivalNotificationEnabled, setArrivalNotificationEnabled] = useState(true);
  const [selectedIsImportant, setSelectedIsImportant] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [saveMessage, setSaveMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
  // Visibility & Duration 상태
  const [selectedVisibility, setSelectedVisibility] = useState<MemoryVisibility>('private');
  const [selectedDuration, setSelectedDuration] = useState<number>(24); // hours
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [draftLocationMode, setDraftLocationMode] = useState<DraftLocationMode>('current');
  const [draftCoordinate, setDraftCoordinate] = useState<DraftCoordinate | null>(null);
  
  // 앱 모드 (My Diary vs Exploration)
  const [appMode, setAppMode] = useState<AppMode>('diary');
  const [nearbyMemories, setNearbyMemories] = useState<Memory[]>([]);
  
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedOffset, setSimulatedOffset] = useState(0);
  
  const mapRef = useRef<MapView>(null);
  const scrollRef = useRef<ScrollView>(null);

  const currentLat = location.coords.latitude + simulatedOffset;
  const currentLon = location.coords.longitude;

  const getDistanceToMemory = (memory: Memory) => getDistanceFromLatLonInMeters(
    currentLat,
    currentLon,
    memory.latitude,
    memory.longitude
  );

  const canManageAtCurrentLocation = (memory: Memory) =>
    canManageMemory(memory, getDistanceToMemory(memory));

  useEffect(() => {
    loadMemories();
  }, []);

  useEffect(() => {
    if (!location || !location.coords || memories.length === 0) return;

    claimForegroundArrivalNotifications(memories, currentLat, currentLon)
      .then(arrivals => Promise.all(arrivals.map(async memory => {
        try {
          await sendArrivalNotification(memory);
        } catch (error) {
          console.error('[MapScreen] Failed to show arrival notification:', error);
          Alert.alert('도착 메모', `"${memory.text}"\n\n저장일: ${memory.date}`, [{ text: '확인' }]);
        }
      })))
      .catch(error => console.error('[MapScreen] Failed to process arrival state:', error));
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
        notificationRepeatMode: m.notificationRepeatMode ?? DEFAULT_NOTIFICATION_REPEAT_MODE,
        arrivalNotificationEnabled: m.arrivalNotificationEnabled ?? true,
        visibility: m.visibility ?? 'private',
        author: m.author ?? 'Me',
        isMine: m.isMine ?? true,
      }));
      setMemories(migrated);
    } catch (error) {
      console.error('메모리 불러오기 실패:', error);
    }
  };

  const resetComposer = () => {
    setMemoryText('');
    setSelectedImageUri(undefined);
    setSelectedRadius(GEOFENCE_RADIUS);
    setSelectedNotificationRepeatMode(DEFAULT_NOTIFICATION_REPEAT_MODE);
    setArrivalNotificationEnabled(true);
    setSelectedIsImportant(false);
    setSelectedVisibility('private');
    setSelectedDuration(24);
    setEditingMemoryId(null);
    setDraftLocationMode('current');
    setDraftCoordinate(null);
  };

  const handleMapPress = (event: MapPressEvent) => {
    if (
      event.nativeEvent.action === 'marker-press' ||
      editingMemoryId ||
      appMode !== 'diary' ||
      selectedVisibility !== 'private' ||
      draftLocationMode !== 'map'
    ) {
      return;
    }

    const { latitude, longitude } = event.nativeEvent.coordinate;
    setDraftCoordinate({ latitude, longitude });
    showMessage('지도에서 메모 위치를 선택했습니다.');
  };

  const handleSelectVisibility = (visibility: MemoryVisibility) => {
    if (editingMemoryId) return;
    setSelectedVisibility(visibility);
    if (visibility === 'public') {
      setDraftLocationMode('current');
      setDraftCoordinate(null);
    }
  };

  const handleSelectLocationMode = (mode: DraftLocationMode) => {
    if (editingMemoryId || selectedVisibility === 'public') return;
    setDraftLocationMode(mode);
    if (mode === 'current') {
      setDraftCoordinate(null);
    } else {
      showMessage('위 지도에서 메모를 남길 위치를 눌러주세요.');
    }
  };

  const beginEditMemory = (memory: Memory) => {
    if (!memory.isMine || !canManageAtCurrentLocation(memory)) {
      Alert.alert('위치 제한', '공개 메모는 저장된 위치의 알림 반경 안에서만 수정할 수 있습니다.');
      return;
    }

    setEditingMemoryId(memory.id);
    setMemoryText(memory.text);
    setSelectedImageUri(memory.imageUri);
    setSelectedRadius(getMemoryRadius(memory));
    setSelectedNotificationRepeatMode(
      memory.notificationRepeatMode ?? DEFAULT_NOTIFICATION_REPEAT_MODE
    );
    setArrivalNotificationEnabled(memory.arrivalNotificationEnabled ?? true);
    setSelectedIsImportant(memory.isImportant);
    setSelectedVisibility(memory.visibility);
    setSelectedDuration(memory.duration ?? 24);
    setDraftLocationMode('map');
    setDraftCoordinate({ latitude: memory.latitude, longitude: memory.longitude });
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const cancelEditMemory = () => {
    resetComposer();
    showMessage('수정을 취소했습니다.');
  };

  const handleSaveMemory = async () => {
    if (!memoryText.trim()) {
      showMessage('✏️ 메모리 내용을 입력해주세요.');
      return;
    }

    setIsSaving(true);

    try {
      if (editingMemoryId) {
        const existingMemory = memories.find(memory => memory.id === editingMemoryId);
        if (!existingMemory) {
          showMessage('수정할 메모를 찾을 수 없습니다.');
          return;
        }

        if (!canManageAtCurrentLocation(existingMemory)) {
          showMessage('공개 메모는 해당 위치에서만 수정할 수 있습니다.');
          resetComposer();
          return;
        }

        const persistentImageUri = await persistMemoryImage(selectedImageUri, existingMemory.id);
        const updatedMemory: Memory = {
          ...existingMemory,
          text: memoryText.trim(),
          isImportant: selectedIsImportant,
          notificationRadius: selectedRadius,
          notificationRepeatMode: selectedNotificationRepeatMode,
          arrivalNotificationEnabled,
          imageUri: persistentImageUri,
          duration: existingMemory.visibility === 'public' ? selectedDuration : undefined,
          expiresAt: existingMemory.visibility === 'public'
            ? Date.now() + selectedDuration * 60 * 60 * 1000
            : undefined,
          updatedAt: new Date().toLocaleString('ko-KR'),
        };

        const updatedMemories = memories.map(memory =>
          memory.id === editingMemoryId ? updatedMemory : memory
        );
        await prepareMemoryNotificationState(updatedMemory, getDistanceToMemory(updatedMemory));
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
        await deletePersistedMemoryImage(
          existingMemory.imageUri !== persistentImageUri ? existingMemory.imageUri : undefined
        );
        setMemories(updatedMemories);
        if (backgroundPermissionGranted) {
          await registerGeofenceForMemory(updatedMemory);
        }

        resetComposer();
        showMessage('메모를 수정했습니다.');
        return;
      }

      let targetCoordinate: DraftCoordinate;
      if (selectedVisibility === 'private' && draftLocationMode === 'map') {
        if (!draftCoordinate) {
          showMessage('지도에서 메모를 남길 위치를 먼저 선택해주세요.');
          return;
        }
        targetCoordinate = draftCoordinate;
      } else {
        showMessage('📍 현재 위치를 가져오는 중...');
        const freshLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        if (!freshLocation?.coords) {
          showMessage('❌ 위치 정보를 찾을 수 없습니다.');
          return;
        }
        targetCoordinate = freshLocation.coords;
      }

      const isPublic = selectedVisibility === 'public';
      const memoryId = Date.now().toString();
      const persistentImageUri = await persistMemoryImage(selectedImageUri, memoryId);
      const newMemory: Memory = {
        id: memoryId,
        text: memoryText.trim(),
        latitude: targetCoordinate.latitude,
        longitude: targetCoordinate.longitude,
        date: new Date().toLocaleString('ko-KR'),
        color: getRandomColor(),
        rotation: getRandomRotation(),
        isImportant: selectedIsImportant,
        notificationRadius: selectedRadius,
        notificationRepeatMode: selectedNotificationRepeatMode,
        arrivalNotificationEnabled,
        imageUri: persistentImageUri,
        visibility: selectedVisibility,
        duration: isPublic ? selectedDuration : undefined,
        expiresAt: isPublic ? Date.now() + selectedDuration * 60 * 60 * 1000 : undefined,
        author: 'Me',
        isMine: true,
      };

      const distanceToNewMemory = getDistanceFromLatLonInMeters(
        currentLat,
        currentLon,
        newMemory.latitude,
        newMemory.longitude
      );
      await prepareMemoryNotificationState(newMemory, distanceToNewMemory);

      const updatedMemories = [...memories, newMemory];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
      setMemories(updatedMemories);
      resetComposer();
      
      // 지오펜스 등록 (백그라운드 알림용)
      if (backgroundPermissionGranted) {
        await registerGeofenceForMemory(newMemory);
        showMessage(arrivalNotificationEnabled
          ? '메모를 저장했습니다. 도착 알림이 켜졌습니다.'
          : '메모를 저장했습니다. 도착 알림은 꺼져 있습니다.');
        console.log(`📍 [MapScreen] Arrival notification ${arrivalNotificationEnabled ? 'enabled' : 'disabled'} for memory ${newMemory.id}`);
      } else {
        showMessage('메모를 저장했습니다.');
      }
      
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
    const targetMemory = memories.find(memory => memory.id === memoryId);
    if (!targetMemory?.isMine || !canManageAtCurrentLocation(targetMemory)) {
      Alert.alert('위치 제한', '공개 메모는 저장된 위치에서만 변경할 수 있습니다.');
      return;
    }

    const updatedMemories = memories.map(memory =>
      memory.id === memoryId ? { ...memory, isImportant: !memory.isImportant } : memory
    );
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
    setMemories(updatedMemories);
  };

  const deleteMemory = async (memoryId: string) => {
    const memoryToDelete = memories.find(memory => memory.id === memoryId);
    if (!memoryToDelete?.isMine || !canManageAtCurrentLocation(memoryToDelete)) {
      Alert.alert('위치 제한', '공개 메모는 저장된 위치에서만 삭제할 수 있습니다.');
      return;
    }

    const updatedMemories = memories.filter(memory => memory.id !== memoryId);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
    setMemories(updatedMemories);
    await unregisterGeofenceForMemory(memoryId);
    await deletePersistedMemoryImage(memoryToDelete?.imageUri);

    if (editingMemoryId === memoryId) {
      resetComposer();
    }
  };

  const handleDeleteMemory = (memoryId: string) => {
    const targetMemory = memories.find(memory => memory.id === memoryId);
    if (!targetMemory?.isMine || !canManageAtCurrentLocation(targetMemory)) {
      Alert.alert('위치 제한', '공개 메모는 저장된 위치에서만 삭제할 수 있습니다.');
      return;
    }

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
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          style={styles.map}
          initialRegion={initialRegion}
          showsUserLocation={!isSimulating}
          showsMyLocationButton={true}
          showsCompass={true}
          onPress={handleMapPress}
        >
          {isSimulating && (
            <Marker
              coordinate={{ latitude: currentLat, longitude: currentLon }}
              title="시뮬레이션 위치"
              pinColor="blue"
            />
          )}

          {appMode === 'diary' && draftCoordinate && (
            <Marker
              coordinate={draftCoordinate}
              title={editingMemoryId ? '메모 저장 위치' : '새 메모 위치'}
              description={editingMemoryId ? '편집 중에는 위치가 유지됩니다.' : '이 위치에 개인 메모가 저장됩니다.'}
              pinColor="#E67E22"
            />
          )}
          
          {displayMemories.map((memory) => {
            const distance = getDistanceFromLatLonInMeters(
              currentLat,
              currentLon,
              memory.latitude,
              memory.longitude
            );
            const isNearby = isMemoryNearby(memory, distance);
            const canRead = canReadMemory(memory, distance);
            const isOthers = !memory.isMine;
            const timerLabel = memory.visibility === 'public' && memory.expiresAt ? ` ⏳${formatRemainingTime(memory.expiresAt)}` : '';
            const authorLabel = isOthers ? ` by ${memory.author}` : '';

            return (
              <Marker
                key={memory.id}
                coordinate={{ latitude: memory.latitude, longitude: memory.longitude }}
                title={canRead ? memory.text : '🔒 이 위치에서만 열람 가능'}
                description={`${formatDistance(distance)} away${timerLabel}${authorLabel}`}
                pinColor={memory.visibility === 'public'
                  ? (isNearby ? (isOthers ? '#3498db' : '#f59e0b') : '#9ca3af')
                  : (isNearby ? '#f59e0b' : '#b9ad84')}
              />
            );
          })}
        </MapView>

        {isSimulating && (
          <View style={styles.simulationBadge}>
            <Text style={styles.simulationBadgeText}>🎮 SIMULATION</Text>
          </View>
        )}

        {appMode === 'diary' && draftLocationMode === 'map' && (
          <View style={styles.mapSelectionBanner}>
            <Text style={styles.mapSelectionBannerText}>
              {editingMemoryId
                ? '편집 중인 메모의 저장 위치입니다.'
                : draftCoordinate
                  ? '선택한 위치에 개인 메모를 저장합니다.'
                  : '지도를 눌러 개인 메모 위치를 선택하세요.'}
            </Text>
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
        <ScrollView ref={scrollRef} style={styles.scrollContainer} contentContainerStyle={styles.bottomContent}>
        {/* 입력 영역 (Diary 모드에서만) */}
        {appMode === 'diary' && <View style={styles.inputSection}>
          <View style={styles.composerHeader}>
            <Text style={styles.composerTitle}>
              {editingMemoryId ? '메모 수정' : '새 위치 메모'}
            </Text>
            {editingMemoryId && (
              <TouchableOpacity style={styles.cancelEditButton} onPress={cancelEditMemory}>
                <Text style={styles.cancelEditButtonText}>수정 취소</Text>
              </TouchableOpacity>
            )}
          </View>

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

          {editingMemoryId ? (
            <View style={styles.fixedLocationInfo}>
              <Text style={styles.fixedLocationInfoText}>저장 위치와 공개 범위는 그대로 유지됩니다.</Text>
            </View>
          ) : selectedVisibility === 'private' ? (
            <View style={styles.locationSection}>
              <Text style={styles.locationLabel}>메모를 남길 위치</Text>
              <View style={styles.locationButtons}>
                <TouchableOpacity
                  style={[styles.locationButton, draftLocationMode === 'current' && styles.locationButtonActive]}
                  onPress={() => handleSelectLocationMode('current')}
                >
                  <Text style={[styles.locationButtonText, draftLocationMode === 'current' && styles.locationButtonTextActive]}>
                    현재 위치
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.locationButton, draftLocationMode === 'map' && styles.locationButtonActive]}
                  onPress={() => handleSelectLocationMode('map')}
                >
                  <Text style={[styles.locationButtonText, draftLocationMode === 'map' && styles.locationButtonTextActive]}>
                    지도에서 선택
                  </Text>
                </TouchableOpacity>
              </View>
              {draftLocationMode === 'map' && (
                <Text style={styles.locationHint}>
                  {draftCoordinate ? '지도 위치가 선택되었습니다.' : '위 지도를 눌러 위치를 지정해주세요.'}
                </Text>
              )}
            </View>
          ) : (
            <View style={styles.fixedLocationInfo}>
              <Text style={styles.fixedLocationInfoText}>공개 메모는 현재 위치에만 작성됩니다.</Text>
            </View>
          )}

          {/* Visibility 토글 */}
          <View style={styles.visibilityToggle}>
            <TouchableOpacity
              style={[
                styles.visibilityBtn,
                selectedVisibility === 'private' && styles.visibilityBtnActive,
                editingMemoryId && styles.visibilityBtnDisabled,
              ]}
              onPress={() => handleSelectVisibility('private')}
              disabled={Boolean(editingMemoryId)}
            >
              <Text style={[styles.visibilityBtnText, selectedVisibility === 'private' && styles.visibilityBtnTextActive]}>
                🔒 Private
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.visibilityBtn,
                selectedVisibility === 'public' && styles.visibilityBtnActivePublic,
                editingMemoryId && styles.visibilityBtnDisabled,
              ]}
              onPress={() => handleSelectVisibility('public')}
              disabled={Boolean(editingMemoryId)}
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

          <View style={styles.arrivalNotificationToggle}>
            <View style={styles.arrivalNotificationToggleCopy}>
              <Text style={styles.arrivalNotificationToggleLabel}>도착 알림</Text>
              <Text style={styles.arrivalNotificationToggleStatus}>
                {arrivalNotificationEnabled ? '앱 PUSH 알림 ON' : '앱 PUSH 알림 OFF'}
              </Text>
            </View>
            <Switch
              value={arrivalNotificationEnabled}
              onValueChange={setArrivalNotificationEnabled}
              trackColor={{ false: '#C8C2B5', true: '#7FA58E' }}
              thumbColor={arrivalNotificationEnabled ? '#2F6B4F' : '#F4F1EA'}
              accessibilityLabel="도착 알림 켜기 또는 끄기"
            />
          </View>

          {arrivalNotificationEnabled && <>
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

          <View style={styles.notificationModeSection}>
            <Text style={styles.notificationModeLabel}>도착 알림 방식</Text>
            <View style={styles.notificationModeButtons}>
              <TouchableOpacity
                style={[
                  styles.notificationModeButton,
                  selectedNotificationRepeatMode === 'repeat' && styles.notificationModeButtonActive,
                ]}
                onPress={() => setSelectedNotificationRepeatMode('repeat')}
              >
                <Text style={[
                  styles.notificationModeButtonText,
                  selectedNotificationRepeatMode === 'repeat' && styles.notificationModeButtonTextActive,
                ]}>
                  다시 올 때마다
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.notificationModeButton,
                  selectedNotificationRepeatMode === 'once' && styles.notificationModeButtonActive,
                ]}
                onPress={() => setSelectedNotificationRepeatMode('once')}
              >
                <Text style={[
                  styles.notificationModeButtonText,
                  selectedNotificationRepeatMode === 'once' && styles.notificationModeButtonTextActive,
                ]}>
                  한 번만
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.notificationModeHint}>
              {selectedNotificationRepeatMode === 'repeat'
                ? `반경에서 ${REENTRY_BUFFER_METERS}m 더 벗어난 뒤 다시 도착하면 알림`
                : '첫 도착 알림 이후에는 다시 알리지 않음'}
            </Text>
          </View>
          </>}

          <TouchableOpacity
            style={[styles.importantToggle, selectedIsImportant && styles.importantToggleActive]}
            onPress={() => setSelectedIsImportant(value => !value)}
          >
            <Text style={styles.importantToggleIcon}>{selectedIsImportant ? '★' : '☆'}</Text>
            <Text style={[styles.importantToggleText, selectedIsImportant && styles.importantToggleTextActive]}>
              {selectedIsImportant ? '중요 메모' : '일반 메모'}
            </Text>
          </TouchableOpacity>

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
              <Text style={styles.saveButtonText}>
                {editingMemoryId ? '변경 내용 저장' : '메모 저장'}
              </Text>
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
                const isNearby = isMemoryNearby(memory, distance);
                const canRead = canReadMemory(memory, distance);
                const isManageable = canManageMemory(memory, distance);
                const isPublic = memory.visibility === 'public';

                return (
                  <View
                    key={memory.id}
                    style={[
                      styles.stickyNote,
                      {
                        backgroundColor: getMemoryCardColor(memory, isNearby),
                        transform: [{ rotate: `${memory.rotation}deg` }],
                      },
                      isPublic && styles.stickyNotePublic,
                    ]}
                  >
                    <View style={styles.pinContainer}>
                      <Text style={styles.pinIcon}>{memory.isImportant ? '📍' : '📌'}</Text>
                    </View>

                    {memory.isMine && isManageable && (
                      <View style={styles.noteActions}>
                        <TouchableOpacity
                          style={styles.noteActionButton}
                          onPress={() => beginEditMemory(memory)}
                          accessibilityLabel="메모 수정"
                        >
                          <Text style={styles.noteActionText}>✎</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.noteActionButton}
                          onPress={() => handleToggleImportant(memory.id)}
                          accessibilityLabel="중요 표시"
                        >
                          <Text style={styles.noteActionText}>{memory.isImportant ? '★' : '☆'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.noteActionButton}
                          onPress={() => handleDeleteMemory(memory.id)}
                          accessibilityLabel="메모 삭제"
                        >
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

                    {!canRead && (
                      <View style={styles.lockSticker}>
                        <Text style={styles.lockIcon}>🔒</Text>
                      </View>
                    )}

                    <View style={styles.noteContent}>
                      {canRead ? (
                        <>
                          {memory.imageUri && <Image source={{ uri: memory.imageUri }} style={styles.noteImage} />}
                          <Text style={styles.noteText} numberOfLines={memory.imageUri ? 2 : 3}>
                            {memory.text}
                          </Text>
                        </>
                      ) : (
              <Text style={styles.lockedText}>이 위치에서만 열람 가능</Text>
                      )}
                    </View>

                    <View style={styles.noteFooter}>
                      <Text style={styles.distanceBadge}>📍 {formatDistance(distance)}</Text>
                      <Text style={styles.radiusBadge}>
                        {isPublic
                          ? `열람 반경 ${getMemoryRadius(memory)}m`
                          : `${isNearby ? '알림 위치 안' : '알림 위치 밖'} · ${getMemoryRadius(memory)}m`}
                      </Text>
                      <Text style={styles.radiusBadge}>
                        {memory.arrivalNotificationEnabled === false
                          ? '알림 OFF'
                          : memory.notificationRepeatMode === 'once'
                            ? '알림 한 번만'
                            : '재도착 알림'}
                      </Text>
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
  mapSelectionBanner: {
    position: 'absolute',
    left: 12,
    right: 72,
    bottom: 16,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,247,209,0.96)',
    borderWidth: 1,
    borderColor: '#E67E22',
  },
  mapSelectionBannerText: {
    color: '#5D3A1A',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
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
  composerHeader: {
    minHeight: 36,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  composerTitle: {
    color: '#5D3A1A',
    fontSize: 20,
    fontFamily: 'NanumPenScript_400Regular',
  },
  cancelEditButton: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 4,
    justifyContent: 'center',
    backgroundColor: 'rgba(93,58,26,0.12)',
  },
  cancelEditButtonText: {
    color: '#5D3A1A',
    fontSize: 13,
    fontWeight: '700',
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
  locationSection: {
    marginTop: 12,
  },
  locationLabel: {
    marginBottom: 6,
    color: '#5D3A1A',
    fontSize: 15,
    fontFamily: 'NanumPenScript_400Regular',
    textAlign: 'center',
  },
  locationButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  locationButton: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderColor: '#DEB887',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  locationButtonActive: {
    backgroundColor: '#5D7A54',
    borderColor: '#5D7A54',
  },
  locationButtonText: {
    color: '#5D3A1A',
    fontSize: 14,
    fontWeight: '700',
  },
  locationButtonTextActive: {
    color: '#FFF',
  },
  locationHint: {
    marginTop: 6,
    color: '#5D7A54',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  fixedLocationInfo: {
    minHeight: 38,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 4,
    justifyContent: 'center',
    backgroundColor: 'rgba(93,122,84,0.12)',
  },
  fixedLocationInfoText: {
    color: '#4E6847',
    fontSize: 12,
    fontWeight: '700',
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
  visibilityBtnDisabled: {
    opacity: 0.75,
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
  arrivalNotificationToggle: {
    minHeight: 54,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#C9B997',
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.58)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  arrivalNotificationToggleCopy: {
    flex: 1,
    paddingRight: 12,
  },
  arrivalNotificationToggleLabel: {
    color: '#5D3A1A',
    fontSize: 15,
    fontWeight: '700',
  },
  arrivalNotificationToggleStatus: {
    marginTop: 2,
    color: '#6D624E',
    fontSize: 12,
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
  notificationModeSection: {
    marginTop: 12,
  },
  notificationModeLabel: {
    marginBottom: 6,
    color: '#5D3A1A',
    fontSize: 15,
    fontFamily: 'NanumPenScript_400Regular',
    textAlign: 'center',
  },
  notificationModeButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  notificationModeButton: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderColor: '#DEB887',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  notificationModeButtonActive: {
    backgroundColor: '#4F7A65',
    borderColor: '#4F7A65',
  },
  notificationModeButtonText: {
    color: '#5D3A1A',
    fontSize: 14,
    fontWeight: '600',
  },
  notificationModeButtonTextActive: {
    color: '#FFF',
  },
  notificationModeHint: {
    marginTop: 6,
    color: '#6D624E',
    fontSize: 12,
    textAlign: 'center',
  },
  importantToggle: {
    minHeight: 42,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#DEB887',
    borderRadius: 4,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  importantToggleActive: {
    backgroundColor: '#FFF0B3',
    borderColor: '#E0A800',
  },
  importantToggleIcon: {
    marginRight: 8,
    color: '#B77900',
    fontSize: 20,
  },
  importantToggleText: {
    color: '#5D3A1A',
    fontSize: 14,
    fontWeight: '700',
  },
  importantToggleTextActive: {
    color: '#8A5A00',
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
    flexDirection: 'column',
    gap: 3,
  },
  noteActionButton: {
    width: 24,
    height: 24,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.82)',
  },
  noteActionText: {
    color: '#5D3A1A',
    fontSize: 15,
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
    paddingRight: 22,
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
