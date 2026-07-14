import React, { useEffect, useState, useMemo } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  TouchableOpacity, 
  TextInput, 
  ScrollView, 
  Platform, 
  Dimensions, 
  ActivityIndicator, 
  ImageBackground,
  Image,
  Modal,
  Pressable,
  Switch,
} from 'react-native';
import { LocationObject } from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts, NanumPenScript_400Regular } from '@expo-google-fonts/nanum-pen-script';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  GEOFENCE_RADIUS,
  GEOFENCE_RADIUS_OPTIONS,
  DEFAULT_NOTIFICATION_REPEAT_MODE,
  REENTRY_BUFFER_METERS,
  claimForegroundArrivalNotifications,
  prepareMemoryNotificationState,
  removeMemoryNotificationState,
  GeofenceRadius,
  NotificationRepeatMode,
} from '../services/GeofencingService';

// Feather 아이콘 SVG 컴포넌트 (웹 호환)
interface FeatherIconProps {
  name: 'map' | 'list';
  size?: number;
  color?: string;
}

const FeatherIcon = ({ name, size = 24, color = '#000' }: FeatherIconProps) => {
  const icons: Record<string, string> = {
    map: `<path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4zm7-4v16m8-12v16" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    list: `<line x1="8" y1="6" x2="21" y2="6" stroke="${color}" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="12" x2="21" y2="12" stroke="${color}" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="18" x2="21" y2="18" stroke="${color}" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="6" x2="3.01" y2="6" stroke="${color}" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="12" x2="3.01" y2="12" stroke="${color}" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="18" x2="3.01" y2="18" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`,
  };
  
  return (
    <View style={{ width: size, height: size }}>
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 24 24" 
        dangerouslySetInnerHTML={{ __html: icons[name] }}
      />
    </View>
  );
};

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

// 필터 타입
type FilterType = 'all' | 'important' | 'general' | 'private' | 'public';

const STORAGE_KEY = '@memories';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const NOTE_SIZE = SCREEN_WIDTH > 768 ? 180 : SCREEN_WIDTH > 480 ? 140 : (SCREEN_WIDTH - 48) / 2;

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
    return isNearby ? memory.color : '#D0D0D0';
  }
  return isNearby ? memory.color : lightenHexColor(memory.color);
}

// Haversine 공식
function getDistanceFromLatLonInMeters(
  lat1: number, lon1: number, lat2: number, lon2: number
): number {
  const R = 6371000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

// 뷰 모드 타입
type ViewMode = 'board' | 'map';
type MarkerStatus = 'locked' | 'unlocked' | 'important' | 'private-far';

// Leaflet 커스텀 마커 아이콘 생성
const createCustomIcon = (status: MarkerStatus) => {
  const iconHtml = status === 'important' 
    ? `<div style="
        background: linear-gradient(135deg, #FF6B6B, #E74C3C);
        width: 36px;
        height: 36px;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 3px 8px rgba(0,0,0,0.4);
        border: 2px solid #fff;
      ">
        <span style="transform: rotate(45deg); font-size: 16px;">⭐</span>
      </div>`
    : status === 'unlocked'
    ? `<div style="
        background: linear-gradient(135deg, #FFE066, #F4D03F);
        width: 32px;
        height: 32px;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 3px 8px rgba(0,0,0,0.3);
        border: 2px solid #fff;
      ">
        <span style="transform: rotate(45deg); font-size: 14px;">📝</span>
      </div>`
    : status === 'private-far'
    ? `<div style="
        background: linear-gradient(135deg, #D8D1B7, #B9AD84);
        width: 32px;
        height: 32px;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 3px 8px rgba(0,0,0,0.25);
        border: 2px solid #fff;
      ">
        <span style="transform: rotate(45deg); font-size: 14px;">📝</span>
      </div>`
    : `<div style="
        background: linear-gradient(135deg, #BDC3C7, #95A5A6);
        width: 32px;
        height: 32px;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 3px 8px rgba(0,0,0,0.3);
        border: 2px solid #fff;
      ">
        <span style="transform: rotate(45deg); font-size: 14px;">🔒</span>
      </div>`;

  return L.divIcon({
    html: iconHtml,
    className: 'custom-marker',
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36],
  });
};

// 사용자 위치 마커 아이콘 (파란색 점)
const userLocationIcon = L.divIcon({
  html: `<div style="
    background: #4285F4;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 3px solid white;
    box-shadow: 0 0 0 2px #4285F4, 0 2px 8px rgba(0,0,0,0.3);
  "></div>`,
  className: 'user-location-marker',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const draftLocationIcon = L.divIcon({
  html: `<div style="
    width: 26px;
    height: 26px;
    background: #E67E22;
    border: 4px solid #FFF7D1;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    box-shadow: 0 2px 7px rgba(0,0,0,0.35);
  "></div>`,
  className: 'draft-location-marker',
  iconSize: [30, 30],
  iconAnchor: [15, 28],
});

// FitBounds 헬퍼 컴포넌트 - 모든 마커를 화면에 맞춤
interface FitBoundsHelperProps {
  positions: [number, number][];
  userPosition: [number, number];
}

function FitBoundsHelper({ positions, userPosition }: FitBoundsHelperProps) {
  const map = useMap();

  useEffect(() => {
    if (positions.length === 0) {
      // 메모리가 없으면 사용자 위치로 줌
      map.setView(userPosition, 15);
      return;
    }

    const allPositions: [number, number][] = [...positions, userPosition];
    const bounds = L.latLngBounds(allPositions.map(pos => L.latLng(pos[0], pos[1])));
    
    // 패딩을 추가하여 마커가 화면 가장자리에 붙지 않도록
    map.fitBounds(bounds, { 
      padding: [50, 50],
      maxZoom: 16,
    });
  }, [map, positions, userPosition]);

  return null;
}

interface MapLocationPickerProps {
  enabled: boolean;
  onSelect: (coordinate: DraftCoordinate) => void;
}

function MapLocationPicker({ enabled, onSelect }: MapLocationPickerProps) {
  useMapEvents({
    click(event) {
      if (!enabled) return;
      onSelect({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });

  return null;
}

interface MapScreenProps {
  location: LocationObject;
  backgroundPermissionGranted?: boolean; // 웹에서는 사용하지 않지만 호환성 유지
}

export default function MapScreen({ location, backgroundPermissionGranted }: MapScreenProps) {
  const [fontsLoaded] = useFonts({ NanumPenScript_400Regular });

  const [memories, setMemories] = useState<Memory[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedOffset, setSimulatedOffset] = useState(0);
  
  // 뷰 모드 상태 (board: 코르크보드, map: 지도)
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  
  // 필터 상태
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  
  // 모달 상태
  const [isWriteModalVisible, setIsWriteModalVisible] = useState(false);
  const [isReadModalVisible, setIsReadModalVisible] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [newMemoryText, setNewMemoryText] = useState('');
  const [newMemoryIsImportant, setNewMemoryIsImportant] = useState(false);
  const [selectedImageUri, setSelectedImageUri] = useState<string | undefined>();
  const [selectedRadius, setSelectedRadius] = useState<GeofenceRadius>(GEOFENCE_RADIUS);
  const [selectedNotificationRepeatMode, setSelectedNotificationRepeatMode] =
    useState<NotificationRepeatMode>(DEFAULT_NOTIFICATION_REPEAT_MODE);
  const [arrivalNotificationEnabled, setArrivalNotificationEnabled] = useState(true);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [draftLocationMode, setDraftLocationMode] = useState<DraftLocationMode>('current');
  const [draftCoordinate, setDraftCoordinate] = useState<DraftCoordinate | null>(null);
  const [isMapPicking, setIsMapPicking] = useState(false);
  
  // Visibility & Duration 상태
  const [selectedVisibility, setSelectedVisibility] = useState<MemoryVisibility>('private');
  const [selectedDuration, setSelectedDuration] = useState<number>(24);
  
  // 앱 모드 (My Diary vs Exploration)
  const [appMode, setAppMode] = useState<AppMode>('diary');
  const [nearbyMemories, setNearbyMemories] = useState<Memory[]>([]);
  
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

  const selectedMemoryDistance = selectedMemory ? getDistanceToMemory(selectedMemory) : null;
  const selectedMemoryNearby = selectedMemory && selectedMemoryDistance !== null
    ? isMemoryNearby(selectedMemory, selectedMemoryDistance)
    : false;
  const selectedMemoryManageable = selectedMemory && selectedMemoryDistance !== null
    ? canManageMemory(selectedMemory, selectedMemoryDistance)
    : false;

  // Mock 데이터 로드
  const handleLoadNearby = () => {
    const mocks = generateMockMemories(currentLat, currentLon);
    setNearbyMemories(mocks);
  };

  // 모드에 따른 기본 메모리
  const modeMemories = appMode === 'diary'
    ? memories.filter(m => m.isMine)
    : [...nearbyMemories, ...memories.filter(m => !m.isMine && m.visibility === 'public')];

  // 필터된 메모리 (기존 필터 위에 모드 적용)
  const filteredMemories = modeMemories.filter(m => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'important') return m.isImportant;
    if (activeFilter === 'general') return !m.isImportant;
    if (activeFilter === 'private') return m.visibility !== 'public';
    if (activeFilter === 'public') return m.visibility === 'public';
    return true;
  });

  // 카운트
  const importantCount = modeMemories.filter(m => m.isImportant).length;
  const generalCount = modeMemories.filter(m => !m.isImportant).length;
  const privateCount = modeMemories.filter(m => m.visibility !== 'public').length;
  const publicCount = modeMemories.filter(m => m.visibility === 'public').length;

  // 지도용 메모리 위치 데이터
  const memoryPositions: [number, number][] = useMemo(() => 
    filteredMemories.map(m => [m.latitude, m.longitude] as [number, number]),
    [filteredMemories]
  );

  const userPosition: [number, number] = useMemo(() => 
    [currentLat, currentLon],
    [currentLat, currentLon]
  );

  // 메모리별 마커 상태 계산
  const getMarkerStatus = (memory: Memory): MarkerStatus => {
    const distance = getDistanceToMemory(memory);
    const isNearby = isMemoryNearby(memory, distance);
    if (memory.visibility === 'public' && !isNearby) return 'locked';
    if (memory.isImportant) return 'important';
    if (memory.visibility === 'private' && !isNearby) return 'private-far';
    return 'unlocked';
  };

  useEffect(() => {
  }, []);

  useEffect(() => {
    loadMemories();
  }, []);

  // 근접 체크 로직
  useEffect(() => {
    if (!location || !location.coords || memories.length === 0) return;

    claimForegroundArrivalNotifications(memories, currentLat, currentLon)
      .then(arrivals => {
        arrivals.forEach(memory => {
          window.alert(`도착 메모\n\n"${memory.text}"\n\n저장일: ${memory.date}`);
        });
      })
      .catch(error => console.error('[MapScreen.web] Failed to process arrival state:', error));
  }, [location, memories, simulatedOffset]);

  const handleTeleport = () => {
    setIsSimulating(true);
    setSimulatedOffset(prev => prev + 0.001);
  };

  const handleResetLocation = () => {
    setIsSimulating(false);
    setSimulatedOffset(0);
  };

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
    setNewMemoryText('');
    setNewMemoryIsImportant(false);
    setSelectedImageUri(undefined);
    setSelectedRadius(GEOFENCE_RADIUS);
    setSelectedNotificationRepeatMode(DEFAULT_NOTIFICATION_REPEAT_MODE);
    setArrivalNotificationEnabled(true);
    setSelectedVisibility('private');
    setSelectedDuration(24);
    setEditingMemoryId(null);
    setDraftLocationMode('current');
    setDraftCoordinate(null);
    setIsMapPicking(false);
  };

  const handleSelectVisibility = (visibility: MemoryVisibility) => {
    if (editingMemoryId) return;
    setSelectedVisibility(visibility);
    if (visibility === 'public') {
      setDraftLocationMode('current');
      setDraftCoordinate(null);
      setIsMapPicking(false);
    }
  };

  const startMapLocationSelection = () => {
    if (editingMemoryId || selectedVisibility === 'public') return;
    setDraftLocationMode('map');
    setIsMapPicking(true);
    setIsWriteModalVisible(false);
    setViewMode('map');
  };

  const handleMapPositionSelected = (coordinate: DraftCoordinate) => {
    setDraftCoordinate(coordinate);
    setDraftLocationMode('map');
    setIsMapPicking(false);
    setIsWriteModalVisible(true);
  };

  const cancelMapLocationSelection = () => {
    setIsMapPicking(false);
    setDraftLocationMode('current');
    setDraftCoordinate(null);
    setIsWriteModalVisible(true);
  };

  const handleSaveMemory = async () => {
    if (!newMemoryText.trim()) return;

    try {
      if (editingMemoryId) {
        const existingMemory = memories.find(memory => memory.id === editingMemoryId);
        if (!existingMemory) return;
        if (!existingMemory.isMine || !canManageAtCurrentLocation(existingMemory)) {
          window.alert('공개 메모는 저장된 위치의 알림 반경 안에서만 수정할 수 있습니다.');
          resetComposer();
          setIsWriteModalVisible(false);
          return;
        }

        const updatedMemory: Memory = {
          ...existingMemory,
          text: newMemoryText.trim(),
          isImportant: newMemoryIsImportant,
          notificationRadius: selectedRadius,
          notificationRepeatMode: selectedNotificationRepeatMode,
          arrivalNotificationEnabled,
          imageUri: selectedImageUri,
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
        setMemories(updatedMemories);
        setSelectedMemory(updatedMemory);
        resetComposer();
        setIsWriteModalVisible(false);
        return;
      }

      const isPublic = selectedVisibility === 'public';
      const targetCoordinate = !isPublic && draftLocationMode === 'map'
        ? draftCoordinate
        : { latitude: currentLat, longitude: currentLon };

      if (!targetCoordinate) return;

      const newMemory: Memory = {
        id: Date.now().toString(),
        text: newMemoryText.trim(),
        latitude: targetCoordinate.latitude,
        longitude: targetCoordinate.longitude,
        date: new Date().toLocaleString('ko-KR'),
        color: getRandomColor(),
        rotation: getRandomRotation(),
        isImportant: newMemoryIsImportant,
        notificationRadius: selectedRadius,
        notificationRepeatMode: selectedNotificationRepeatMode,
        arrivalNotificationEnabled,
        imageUri: selectedImageUri,
        visibility: selectedVisibility,
        duration: isPublic ? selectedDuration : undefined,
        expiresAt: isPublic ? Date.now() + selectedDuration * 60 * 60 * 1000 : undefined,
        author: 'Me',
        isMine: true,
      };

      await prepareMemoryNotificationState(newMemory, getDistanceToMemory(newMemory));
      const updatedMemories = [...memories, newMemory];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
      setMemories(updatedMemories);
      resetComposer();
      setIsWriteModalVisible(false);
    } catch (error) {
      console.error('메모리 저장 실패:', error);
    }
  };

  const handleDeleteMemory = async (memoryId: string) => {
    try {
      const targetMemory = memories.find(memory => memory.id === memoryId);
      if (!targetMemory?.isMine || !canManageAtCurrentLocation(targetMemory)) {
        window.alert('공개 메모는 저장된 위치의 알림 반경 안에서만 삭제할 수 있습니다.');
        return;
      }

      if (Platform.OS === 'web' && !window.confirm('이 위치 메모를 삭제할까요?')) return;

      const updatedMemories = memories.filter(m => m.id !== memoryId);
      await removeMemoryNotificationState(memoryId);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
      setMemories(updatedMemories);
      setIsReadModalVisible(false);
      setSelectedMemory(null);
      if (editingMemoryId === memoryId) {
        resetComposer();
        setIsWriteModalVisible(false);
      }
    } catch (error) {
      console.error('메모리 삭제 실패:', error);
    }
  };

  // 중요 표시 토글
  const handleToggleImportant = async (memoryId: string) => {
    try {
      const targetMemory = memories.find(memory => memory.id === memoryId);
      if (!targetMemory?.isMine || !canManageAtCurrentLocation(targetMemory)) {
        window.alert('공개 메모는 저장된 위치에서만 변경할 수 있습니다.');
        return;
      }

      const updatedMemories = memories.map(m => 
        m.id === memoryId ? { ...m, isImportant: !m.isImportant } : m
      );
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
      setMemories(updatedMemories);
      // 선택된 메모리도 업데이트
      if (selectedMemory && selectedMemory.id === memoryId) {
        setSelectedMemory({ ...selectedMemory, isImportant: !selectedMemory.isImportant });
      }
    } catch (error) {
      console.error('중요 표시 변경 실패:', error);
    }
  };

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const persistentUri = asset.base64
        ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`
        : asset.uri;
      setSelectedImageUri(persistentUri);
    }
  };

  const openReadModal = (memory: Memory) => {
    setSelectedMemory(memory);
    setIsReadModalVisible(true);
  };

  const openWriteModal = () => {
    resetComposer();
    setIsWriteModalVisible(true);
  };

  const closeWriteModal = () => {
    resetComposer();
    setIsWriteModalVisible(false);
  };

  const openEditMemory = (memory: Memory) => {
    if (!memory.isMine || !canManageAtCurrentLocation(memory)) {
      window.alert('공개 메모는 저장된 위치의 알림 반경 안에서만 수정할 수 있습니다.');
      return;
    }

    setEditingMemoryId(memory.id);
    setNewMemoryText(memory.text);
    setNewMemoryIsImportant(memory.isImportant);
    setSelectedImageUri(memory.imageUri);
    setSelectedRadius(getMemoryRadius(memory));
    setSelectedNotificationRepeatMode(
      memory.notificationRepeatMode ?? DEFAULT_NOTIFICATION_REPEAT_MODE
    );
    setArrivalNotificationEnabled(memory.arrivalNotificationEnabled ?? true);
    setSelectedVisibility(memory.visibility);
    setSelectedDuration(memory.duration ?? 24);
    setDraftLocationMode('map');
    setDraftCoordinate({ latitude: memory.latitude, longitude: memory.longitude });
    setIsReadModalVisible(false);
    setIsWriteModalVisible(true);
  };


  if (!fontsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8B4513" />
        <Text style={styles.loadingText}>Loading fonts...</Text>
      </View>
    );
  }

  return (
    <ImageBackground source={corkboardBg} style={styles.backgroundImage} resizeMode="cover">
      {/* 헤더 */}
      <View style={styles.header}>
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
              <Text style={styles.loadNearbyBtnIcon}>🔄</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>📍 Memory Delivery</Text>
            <Text style={styles.headerSubtitle}>
              {isSimulating ? `🎮 시뮬레이션 (+${Math.round(simulatedOffset * 111000)}m)` : 
               appMode === 'diary' ? `${modeMemories.length}개의 내 추억` : `${modeMemories.length}개의 주변 노트`}
            </Text>
          </View>
          
          {/* 뷰 모드 토글 버튼 */}
          <View style={styles.headerRight}>
            <TouchableOpacity 
              style={styles.viewToggleBtn} 
              onPress={() => setViewMode(viewMode === 'board' ? 'map' : 'board')}
              activeOpacity={0.7}
            >
              <FeatherIcon 
                name={viewMode === 'board' ? 'map' : 'list'} 
                size={22} 
                color="#FFF7D1" 
              />
            </TouchableOpacity>
          </View>
        </View>
        
        {/* 디버그 버튼 */}
        <View style={styles.debugButtons}>
          <TouchableOpacity style={styles.debugBtn} onPress={handleTeleport}>
            <Text style={styles.debugBtnText}>🚀</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.debugBtn} onPress={handleResetLocation}>
            <Text style={styles.debugBtnText}>📍</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 탭 바 (필터) */}
      <View style={styles.tabBar}>
        <TouchableOpacity 
          style={[styles.tab, activeFilter === 'all' && styles.tabActive]}
          onPress={() => setActiveFilter('all')}
        >
          <Text style={[styles.tabText, activeFilter === 'all' && styles.tabTextActive]}>
            전체 ({memories.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeFilter === 'private' && styles.tabActive]}
          onPress={() => setActiveFilter('private')}
        >
          <Text style={[styles.tabText, activeFilter === 'private' && styles.tabTextActive]}>
            🔒 Private ({privateCount})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeFilter === 'public' && styles.tabActivePublic]}
          onPress={() => setActiveFilter('public')}
        >
          <Text style={[styles.tabText, activeFilter === 'public' && styles.tabTextActive]}>
            📢 Public ({publicCount})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeFilter === 'important' && styles.tabActive]}
          onPress={() => setActiveFilter('important')}
        >
          <Text style={[styles.tabText, activeFilter === 'important' && styles.tabTextActive]}>
            ⭐ ({importantCount})
          </Text>
        </TouchableOpacity>
      </View>

      {/* 코르크보드 뷰 (Board View) */}
      {viewMode === 'board' && (
        <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.notesContainer}>
          {filteredMemories.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>
                {activeFilter === 'important' ? '⭐' : activeFilter === 'general' ? '📝' : '📭'}
              </Text>
              <Text style={styles.emptyText}>
                {activeFilter === 'important' ? '중요한 추억이 없습니다' : 
                 activeFilter === 'general' ? '일반 추억이 없습니다' : '아직 추억이 없습니다'}
              </Text>
              <Text style={styles.emptySubtext}>우측 하단 버튼을 눌러 추억을 남겨보세요!</Text>
            </View>
          ) : (
            <View style={styles.notesGrid}>
              {filteredMemories.map((memory) => {
                const distance = getDistanceFromLatLonInMeters(currentLat, currentLon, memory.latitude, memory.longitude);
                const isNearby = isMemoryNearby(memory, distance);
                const canRead = canReadMemory(memory, distance);

                return (
                  <TouchableOpacity
                    key={memory.id}
                    style={[
                      styles.stickyNote,
                      {
                        backgroundColor: getMemoryCardColor(memory, isNearby),
                        transform: [{ rotate: `${memory.rotation}deg` }],
                        width: NOTE_SIZE,
                        height: NOTE_SIZE,
                      },
                      memory.visibility === 'public' && styles.stickyNotePublic,
                    ]}
                    onPress={() => openReadModal(memory)}
                    activeOpacity={0.8}
                  >
                    {/* 핀 */}
                    <View style={styles.pinContainer}>
                      <Text style={styles.pinIcon}>{memory.isImportant ? '📍' : '📌'}</Text>
                    </View>

                    {/* Visibility 뱃지 */}
                    <View style={[
                      styles.typeBadge, 
                      memory.visibility === 'public' ? styles.typeBadgePublic : styles.typeBadgePrivate
                    ]}>
                      <Text style={styles.typeBadgeText}>
                        {memory.visibility === 'public' ? '📢' : '🔒'}
                      </Text>
                    </View>

                    {/* 중요 표시 별 */}
                    {memory.isImportant && (
                      <View style={styles.starBadge}>
                        <Text style={styles.starIcon}>⭐</Text>
                      </View>
                    )}

                    {/* Public 타이머 뱃지 */}
                    {memory.visibility === 'public' && memory.expiresAt && (
                      <View style={styles.timerBadge}>
                        <Text style={styles.timerBadgeText}>
                          ⏳ {formatRemainingTime(memory.expiresAt)}
                        </Text>
                      </View>
                    )}

                    {/* 잠금 스티커 */}
                    {!canRead && (
                      <View style={styles.lockSticker}>
                        <Text style={styles.lockIcon}>🔒</Text>
                      </View>
                    )}

                    {/* 내용 */}
                    <View style={styles.noteContent}>
                      {canRead ? (
                        <>
                          {memory.imageUri && <Image source={{ uri: memory.imageUri }} style={styles.noteImage} />}
                          <Text style={styles.noteText} numberOfLines={memory.imageUri ? 2 : 3}>{memory.text}</Text>
                        </>
                      ) : (
                <Text style={styles.lockedText}>이 위치에서만 열람 가능</Text>
                      )}
                    </View>

                    {/* 거리 + author */}
                    <Text style={styles.distanceBadge}>📍 {formatDistance(distance)}</Text>
                    <Text style={styles.radiusBadge}>
                      {memory.visibility === 'public'
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
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      {/* 지도 뷰 (Map View) */}
      {viewMode === 'map' && (
        <View style={styles.mapContainer}>
          <MapContainer
            center={userPosition}
            zoom={15}
            style={{ width: '100%', height: '100%' }}
            zoomControl={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapLocationPicker enabled={isMapPicking} onSelect={handleMapPositionSelected} />

            {draftCoordinate && (
              <Marker
                position={[draftCoordinate.latitude, draftCoordinate.longitude]}
                icon={draftLocationIcon}
              >
                <Popup>
                  <div style={{ textAlign: 'center', fontFamily: 'sans-serif' }}>
                    <strong>{editingMemoryId ? '메모 저장 위치' : '새 개인 메모 위치'}</strong>
                  </div>
                </Popup>
              </Marker>
            )}
            
            {/* 자동 줌 (모든 마커에 맞춤) */}
            <FitBoundsHelper positions={memoryPositions} userPosition={userPosition} />
            
            {/* 사용자 현재 위치 마커 (파란색 점) */}
            <Marker position={userPosition} icon={userLocationIcon}>
              <Popup>
                <div style={{ textAlign: 'center', fontFamily: 'sans-serif' }}>
                  <strong>📍 현재 위치</strong>
                </div>
              </Popup>
            </Marker>
            
            {/* 메모리 마커들 */}
            {filteredMemories.map((memory) => {
              const distance = getDistanceFromLatLonInMeters(currentLat, currentLon, memory.latitude, memory.longitude);
              const isNearby = isMemoryNearby(memory, distance);
              const canRead = canReadMemory(memory, distance);
              const isManageable = canManageMemory(memory, distance);
              const markerStatus = getMarkerStatus(memory);
              const markerIcon = createCustomIcon(markerStatus);

              return (
                <Marker 
                  key={memory.id} 
                  position={[memory.latitude, memory.longitude]}
                  icon={markerIcon}
                >
                  <Popup>
                    <div style={{ 
                      minWidth: '200px', 
                      fontFamily: 'sans-serif',
                      padding: '8px'
                    }}>
                      {/* 제목/텍스트 */}
                      <div style={{ 
                        fontSize: '14px', 
                        fontWeight: 'bold',
                        marginBottom: '8px',
                        color: '#333',
                        borderBottom: '1px solid #eee',
                        paddingBottom: '8px'
                      }}>
                        {memory.visibility === 'public' && <span style={{ marginRight: '4px' }}>📢</span>}
                        {memory.isImportant && <span style={{ marginRight: '4px' }}>⭐</span>}
                        {canRead
                          ? (memory.text.length > 30 ? memory.text.substring(0, 30) + '...' : memory.text)
                          : '🔒 잠긴 메모리'
                        }
                      </div>
                      
                      {/* 거리 + 타이머 + author */}
                      <div style={{ 
                        fontSize: '13px', 
                        color: '#666',
                        marginBottom: '8px'
                      }}>
                        📍 {formatDistance(distance)} away
                        {memory.visibility === 'public' && memory.expiresAt && (
                          <span style={{ 
                            marginLeft: '8px', 
                            color: '#3498db',
                            fontWeight: 'bold'
                          }}>
                            ⏳ {formatRemainingTime(memory.expiresAt)}
                          </span>
                        )}
                      </div>
                      {!memory.isMine && (
                        <div style={{
                          fontSize: '12px',
                          color: '#3498db',
                          fontWeight: 'bold',
                          marginBottom: '8px',
                        }}>
                          ✍️ by {memory.author}
                        </div>
                      )}
                      
                      {/* 상태 메시지 */}
                      <div style={{ 
                        fontSize: '13px',
                        padding: '8px',
                        borderRadius: '8px',
                        backgroundColor: memory.visibility === 'private' && !isNearby
                          ? '#F4F0E2'
                          : canRead ? '#E8F5E9' : '#FFF3E0',
                        textAlign: 'center',
                        marginBottom: '8px'
                      }}>
                        {memory.visibility === 'private'
                          ? (isNearby ? '개인 메모 · 알림 반경 안' : '개인 메모 · 알림 반경 밖')
                          : canRead ? '공개 메모 열람 가능' : '공개 메모는 위치에서만 열람 가능'}
                      </div>
                      
                      {/* 개인 메모는 어디서나, 공개 메모는 위치에서만 관리 가능 */}
                      {memory.isMine && isManageable ? (
                        <button
                          onClick={() => openReadModal(memory)}
                          style={{
                            width: '100%',
                            padding: '10px',
                            backgroundColor: '#5D7A54',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '14px',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                          }}
                        >
                          메모 관리
                        </button>
                      ) : canRead && (
                        <button
                          onClick={() => openReadModal(memory)}
                          style={{
                            width: '100%',
                            padding: '10px',
                            backgroundColor: '#E67E22',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '14px',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                          }}
                        >
                          📖 추억 읽기
                        </button>
                      )}
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>

          {isMapPicking && (
            <View style={styles.mapPickerBanner}>
              <Text style={styles.mapPickerBannerText}>지도를 눌러 개인 메모 위치를 선택하세요.</Text>
              <TouchableOpacity style={styles.mapPickerCancelButton} onPress={cancelMapLocationSelection}>
                <Text style={styles.mapPickerCancelButtonText}>취소</Text>
              </TouchableOpacity>
            </View>
          )}
          
          {/* 지도 위 필터된 메모리 카운트 */}
          <View style={styles.mapOverlayInfo}>
            <Text style={styles.mapOverlayText}>
              {filteredMemories.length}개의 추억이 지도에 표시됨
            </Text>
          </View>
        </View>
      )}

      {/* FAB (Floating Action Button) - Diary 모드에서만 */}
      {appMode === 'diary' && (
        <TouchableOpacity 
          style={styles.fab} 
          onPress={openWriteModal}
          activeOpacity={0.8}
        >
          <Text style={styles.fabIcon}>✏️</Text>
        </TouchableOpacity>
      )}

      {/* 작성 모달 */}
      <Modal
        visible={isWriteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeWriteModal}
      >
        <Pressable style={styles.modalOverlay} onPress={closeWriteModal}>
          <Pressable style={[styles.modalNote, { backgroundColor: '#FFF7D1' }]} onPress={() => {}}>
            <View style={styles.modalPinContainer}>
              <Text style={styles.modalPin}>{newMemoryIsImportant ? '📍' : '📌'}</Text>
            </View>

            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
            <Text style={styles.modalTitle}>{editingMemoryId ? '메모 수정' : '새 위치 메모'}</Text>
            
            <TextInput
              style={styles.modalInput}
              placeholder="여기에 추억을 남겨주세요..."
              placeholderTextColor="#a89f6a"
              value={newMemoryText}
              onChangeText={setNewMemoryText}
              multiline
              autoFocus
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
                    onPress={() => {
                      setDraftLocationMode('current');
                      setDraftCoordinate(null);
                    }}
                  >
                    <Text style={[styles.locationButtonText, draftLocationMode === 'current' && styles.locationButtonTextActive]}>
                      현재 위치
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.locationButton, draftLocationMode === 'map' && styles.locationButtonActive]}
                    onPress={startMapLocationSelection}
                  >
                    <Text style={[styles.locationButtonText, draftLocationMode === 'map' && styles.locationButtonTextActive]}>
                      지도에서 선택
                    </Text>
                  </TouchableOpacity>
                </View>
                {draftCoordinate && <Text style={styles.locationHint}>지도 위치가 선택되었습니다.</Text>}
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

            {/* 중요 표시 토글 */}
            <TouchableOpacity 
              style={styles.importantToggle}
              onPress={() => setNewMemoryIsImportant(!newMemoryIsImportant)}
            >
              <Text style={styles.importantToggleIcon}>
                {newMemoryIsImportant ? '⭐' : '☆'}
              </Text>
              <Text style={[
                styles.importantToggleText,
                newMemoryIsImportant && styles.importantToggleTextActive
              ]}>
                {newMemoryIsImportant ? '중요한 추억' : '일반 추억'}
              </Text>
            </TouchableOpacity>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={closeWriteModal}>
                <Text style={styles.cancelBtnText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveMemory}>
                <Text style={styles.saveBtnText}>{editingMemoryId ? '변경 저장' : '메모 저장'}</Text>
              </TouchableOpacity>
            </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 읽기 모달 */}
      <Modal
        visible={isReadModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsReadModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsReadModalVisible(false)}>
          {selectedMemory && (
            <Pressable 
              style={[styles.modalNote, { backgroundColor: getMemoryCardColor(selectedMemory, selectedMemoryNearby) }]}
              onPress={() => {}}
            >
              <View style={styles.modalPinContainer}>
                <Text style={styles.modalPin}>{selectedMemory.isImportant ? '📍' : '📌'}</Text>
              </View>

              {/* 상단 버튼들 */}
              {selectedMemory.isMine && selectedMemoryManageable && <View style={styles.modalTopButtons}>
                <TouchableOpacity
                  style={styles.editBtn}
                  onPress={() => openEditMemory(selectedMemory)}
                  accessibilityLabel="메모 수정"
                >
                  <Text style={styles.editBtnIcon}>✎</Text>
                </TouchableOpacity>

                {/* 중요 토글 버튼 */}
                <TouchableOpacity 
                  style={styles.starToggleBtn} 
                  onPress={() => handleToggleImportant(selectedMemory.id)}
                >
                  <Text style={styles.starToggleIcon}>
                    {selectedMemory.isImportant ? '⭐' : '☆'}
                  </Text>
                </TouchableOpacity>

                {/* 삭제 버튼 */}
                <TouchableOpacity 
                  style={styles.deleteBtn} 
                  onPress={() => handleDeleteMemory(selectedMemory.id)}
                >
                  <Text style={styles.deleteBtnIcon}>🗑️</Text>
                </TouchableOpacity>
              </View>}
              
              {(() => {
                const distance = selectedMemoryDistance ?? getDistanceToMemory(selectedMemory);
                const canRead = canReadMemory(selectedMemory, distance);
                
                return (
                  <>
                    <View style={styles.modalContent}>
                      {canRead ? (
                        <>
                          {selectedMemory.imageUri && (
                            <Image source={{ uri: selectedMemory.imageUri }} style={styles.modalImage} />
                          )}
                          <Text style={styles.modalText}>{selectedMemory.text}</Text>
                        </>
                      ) : (
                        <>
                          <Text style={styles.modalLockedIcon}>🔒</Text>
                          <Text style={styles.modalLockedText}>
                            공개 메모는 저장된 위치의 알림 반경 안에서만 열람할 수 있습니다.
                          </Text>
                        </>
                      )}
                    </View>
                    
                    <View style={styles.modalFooter}>
                      <Text style={styles.modalDate}>🕐 {selectedMemory.date}</Text>
                      <Text style={styles.modalDistance}>📍 {formatDistance(distance)}</Text>
                    </View>
                    {/* Visibility & Timer info */}
                    <View style={styles.modalVisibilityInfo}>
                      <Text style={styles.modalVisibilityText}>
                        {selectedMemory.visibility === 'public' ? '📢 Public' : '🔒 Private'}
                      </Text>
                      {selectedMemory.visibility === 'public' && selectedMemory.expiresAt && (
                        <Text style={styles.modalTimerText}>
                          ⏳ {formatRemainingTime(selectedMemory.expiresAt)}
                        </Text>
                      )}
                      <Text style={styles.modalTimerText}>알림 {getMemoryRadius(selectedMemory)}m</Text>
                      <Text style={styles.modalTimerText}>
                        {selectedMemory.arrivalNotificationEnabled === false
                          ? '알림 OFF'
                          : selectedMemory.notificationRepeatMode === 'once'
                            ? '알림 한 번만'
                            : '재도착 알림'}
                      </Text>
                    </View>
                  </>
                );
              })()}
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
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
  backgroundImage: {
    flex: 1,
  },
  // 모드 토글
  modeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
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
    marginLeft: 4,
  },
  loadNearbyBtnIcon: {
    fontSize: 18,
  },
  // 헤더
  header: {
    backgroundColor: 'rgba(60, 30, 10, 0.85)',
    paddingTop: 50,
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flex: 1,
    alignItems: 'center',
  },
  headerRight: {
    position: 'absolute',
    right: 0,
    top: 0,
  },
  viewToggleBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,247,209,0.3)',
  },
  headerTitle: {
    fontSize: 32,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#FFF7D1',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  headerSubtitle: {
    fontSize: 16,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#DEB887',
    marginTop: 4,
  },
  debugButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  debugBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  debugBtnText: {
    fontSize: 18,
  },
  // 탭 바
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(60, 30, 10, 0.75)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
    gap: 8,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  tabActive: {
    backgroundColor: '#E67E22',
  },
  tabActivePublic: {
    backgroundColor: '#3498db',
  },
  tabText: {
    fontSize: 14,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#DEB887',
  },
  tabTextActive: {
    color: '#FFF',
  },
  // 스크롤 컨테이너
  scrollContainer: {
    flex: 1,
  },
  notesContainer: {
    padding: 16,
    paddingBottom: 100,
  },
  // 지도 컨테이너
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  mapOverlayInfo: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    backgroundColor: 'rgba(60, 30, 10, 0.85)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  mapOverlayText: {
    fontSize: 14,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#FFF7D1',
  },
  mapPickerBanner: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,247,209,0.97)',
    borderWidth: 1,
    borderColor: '#E67E22',
  },
  mapPickerBannerText: {
    flexShrink: 1,
    color: '#5D3A1A',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  mapPickerCancelButton: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 4,
    justifyContent: 'center',
    backgroundColor: '#5D3A1A',
  },
  mapPickerCancelButtonText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyIcon: {
    fontSize: 60,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 24,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#5D3A1A',
  },
  emptySubtext: {
    fontSize: 18,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#8B5A2B',
    marginTop: 8,
    textAlign: 'center',
  },
  // Notes Grid
  notesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
  },
  // Sticky Note
  stickyNote: {
    padding: 10,
    borderRadius: 2,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  stickyNotePublic: {
    borderLeftWidth: 3,
    borderLeftColor: '#3498db',
  },
  // Type 뱃지 (Public/Private)
  typeBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    zIndex: 10,
  },
  typeBadgePublic: {
    backgroundColor: '#D6EAF8',
  },
  typeBadgePrivate: {
    backgroundColor: '#FADBD8',
  },
  typeBadgeText: {
    fontSize: 9,
  },
  // 타이머 뱃지
  timerBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(52,152,219,0.85)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    elevation: 2,
    zIndex: 10,
  },
  timerBadgeText: {
    fontSize: 8,
    color: '#FFF',
    fontWeight: '600',
  },
  pinContainer: {
    position: 'absolute',
    top: -8,
    alignSelf: 'center',
    zIndex: 10,
  },
  pinIcon: {
    fontSize: 18,
  },
  starBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    zIndex: 10,
  },
  starIcon: {
    fontSize: 16,
  },
  lockSticker: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: '#FF6B6B',
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
  },
  lockIcon: {
    fontSize: 12,
  },
  noteContent: {
    flex: 1,
    marginTop: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noteText: {
    fontSize: 15,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#333',
    textAlign: 'center',
    lineHeight: 20,
  },
  noteImage: {
    width: '100%',
    height: 62,
    borderRadius: 3,
    marginBottom: 4,
  },
  lockedText: {
    fontSize: 13,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#888',
    textAlign: 'center',
  },
  distanceBadge: {
    fontSize: 11,
    color: '#666',
    backgroundColor: 'rgba(255,255,255,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: 'center',
    marginTop: 6,
    overflow: 'hidden',
  },
  authorBadge: {
    fontSize: 9,
    color: '#3498db',
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
  },
  // FAB
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 24,
    backgroundColor: '#E67E22',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 8,
  },
  fabIcon: {
    fontSize: 28,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalNote: {
    width: '100%',
    maxWidth: 320,
    maxHeight: '90%',
    minHeight: 300,
    borderRadius: 4,
    padding: 24,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  modalScroll: {
    width: '100%',
  },
  modalScrollContent: {
    paddingBottom: 4,
  },
  modalPinContainer: {
    position: 'absolute',
    top: -12,
    alignSelf: 'center',
  },
  radiusBadge: {
    marginTop: 3,
    color: '#5a5230',
    fontSize: 9,
    textAlign: 'center',
  },
  modalPin: {
    fontSize: 28,
  },
  modalTitle: {
    fontSize: 26,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#5a5230',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  modalInput: {
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: 4,
    padding: 14,
    fontSize: 18,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#333',
    minHeight: 80,
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
    color: '#5a5230',
    fontSize: 16,
    fontFamily: 'NanumPenScript_400Regular',
  },
  imagePreviewContainer: {
    marginTop: 10,
  },
  imagePreview: {
    width: '100%',
    height: 120,
    borderRadius: 4,
  },
  locationSection: {
    marginTop: 12,
  },
  locationLabel: {
    marginBottom: 6,
    color: '#5a5230',
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
    color: '#5a5230',
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
    color: '#5a5230',
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
    color: '#5a5230',
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
    color: '#5a5230',
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
    color: '#5a5230',
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
    color: '#5a5230',
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
    color: '#5a5230',
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
    color: '#5a5230',
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
    color: '#5a5230',
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
  // 중요 표시 토글
  importantToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderRadius: 20,
  },
  importantToggleIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  importantToggleText: {
    fontSize: 16,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#888',
  },
  importantToggleTextActive: {
    color: '#E67E22',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 20,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 16,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#666',
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#E67E22',
    borderRadius: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  saveBtnText: {
    fontSize: 18,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#FFF',
  },
  // 상단 버튼들
  modalTopButtons: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    gap: 8,
  },
  editBtn: {
    backgroundColor: 'rgba(93,122,84,0.92)',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
  },
  editBtnIcon: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '700',
  },
  starToggleBtn: {
    backgroundColor: 'rgba(255,200,50,0.9)',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
  },
  starToggleIcon: {
    fontSize: 20,
  },
  deleteBtn: {
    backgroundColor: 'rgba(255,100,100,0.9)',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
  },
  deleteBtnIcon: {
    fontSize: 18,
  },
  // Modal Content
  modalContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  modalImage: {
    width: '100%',
    height: 150,
    borderRadius: 4,
    marginBottom: 12,
  },
  modalText: {
    fontSize: 22,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#333',
    textAlign: 'center',
    lineHeight: 30,
  },
  modalLockedIcon: {
    fontSize: 50,
    marginBottom: 16,
  },
  modalLockedText: {
    fontSize: 18,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#666',
    textAlign: 'center',
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  modalDate: {
    fontSize: 14,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#666',
  },
  modalDistance: {
    fontSize: 14,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#666',
  },
  // Modal visibility/timer info
  modalVisibilityInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  modalVisibilityText: {
    fontSize: 13,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#888',
  },
  modalTimerText: {
    fontSize: 13,
    fontFamily: 'NanumPenScript_400Regular',
    color: '#3498db',
    fontWeight: '600',
  },
});
