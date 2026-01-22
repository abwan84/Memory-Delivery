import React, { useEffect, useState, useRef, useMemo } from 'react';
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
  Modal,
  Pressable,
} from 'react-native';
import { LocationObject } from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts, NanumPenScript_400Regular } from '@expo-google-fonts/nanum-pen-script';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

// Memory 데이터 타입 정의 (isImportant 추가)
interface Memory {
  id: string;
  text: string;
  latitude: number;
  longitude: number;
  date: string;
  color: string;
  rotation: number;
  isImportant: boolean; // 중요 표시
}

// 필터 타입
type FilterType = 'all' | 'important' | 'general';

const STORAGE_KEY = '@memories';
const PROXIMITY_THRESHOLD = 50;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const NOTE_SIZE = SCREEN_WIDTH > 768 ? 180 : SCREEN_WIDTH > 480 ? 140 : (SCREEN_WIDTH - 48) / 2;

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

// Leaflet 커스텀 마커 아이콘 생성
const createCustomIcon = (status: 'locked' | 'unlocked' | 'important') => {
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
  
  const alertedMemoriesRef = useRef<Set<string>>(new Set());

  const currentLat = location.coords.latitude + simulatedOffset;
  const currentLon = location.coords.longitude;

  // 필터된 메모리
  const filteredMemories = memories.filter(m => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'important') return m.isImportant;
    if (activeFilter === 'general') return !m.isImportant;
    return true;
  });

  // 카운트
  const importantCount = memories.filter(m => m.isImportant).length;
  const generalCount = memories.filter(m => !m.isImportant).length;

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
  const getMarkerStatus = (memory: Memory): 'locked' | 'unlocked' | 'important' => {
    const distance = getDistanceFromLatLonInMeters(currentLat, currentLon, memory.latitude, memory.longitude);
    const isUnlocked = distance < PROXIMITY_THRESHOLD;
    if (memory.isImportant) return 'important';
    if (isUnlocked) return 'unlocked';
    return 'locked';
  };

  useEffect(() => {
    debugLog('MapScreen.web.tsx:mount', 'MapScreen (web) mounted', { lat: location?.coords?.latitude, lng: location?.coords?.longitude }, 'A');
  }, []);

  useEffect(() => {
    loadMemories();
  }, []);

  // 근접 체크 로직
  useEffect(() => {
    if (!location || !location.coords || memories.length === 0) return;

    memories.forEach((memory) => {
      const distance = getDistanceFromLatLonInMeters(currentLat, currentLon, memory.latitude, memory.longitude);
      if (distance < PROXIMITY_THRESHOLD && !alertedMemoriesRef.current.has(memory.id)) {
        const message = `🎉 You found a memory!\n\n"${memory.text}"\n\nSaved on: ${memory.date}`;
        if (Platform.OS === 'web') {
          window.alert(message);
        }
        alertedMemoriesRef.current.add(memory.id);
        debugLog('MapScreen.web.tsx:geofence', 'Memory unlocked!', { memoryId: memory.id, distance }, 'A');
      }
    });
  }, [location, memories, simulatedOffset]);

  const handleTeleport = () => {
    setIsSimulating(true);
    setSimulatedOffset(prev => prev + 0.001);
  };

  const handleResetLocation = () => {
    setIsSimulating(false);
    setSimulatedOffset(0);
    alertedMemoriesRef.current.clear();
  };

  const loadMemories = async () => {
    try {
      const storedMemories = await AsyncStorage.getItem(STORAGE_KEY);
      if (storedMemories) {
        const parsed = JSON.parse(storedMemories);
        // 기존 메모리 마이그레이션 (isImportant 필드 추가)
        const migrated = parsed.map((m: Memory) => ({
          ...m,
          color: m.color || getRandomColor(),
          rotation: m.rotation !== undefined ? m.rotation : getRandomRotation(),
          isImportant: m.isImportant ?? false, // 기본값 false
        }));
        setMemories(migrated);
      }
    } catch (error) {
      console.error('메모리 불러오기 실패:', error);
    }
  };

  const handleSaveMemory = async () => {
    if (!newMemoryText.trim()) return;

    try {
      const newMemory: Memory = {
        id: Date.now().toString(),
        text: newMemoryText.trim(),
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        date: new Date().toLocaleString('ko-KR'),
        color: getRandomColor(),
        rotation: getRandomRotation(),
        isImportant: newMemoryIsImportant,
      };

      const updatedMemories = [...memories, newMemory];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
      setMemories(updatedMemories);
      setNewMemoryText('');
      setNewMemoryIsImportant(false);
      setIsWriteModalVisible(false);
      debugLog('MapScreen.web.tsx:saveMemory', 'Memory saved', { memory: newMemory }, 'A');
    } catch (error) {
      console.error('메모리 저장 실패:', error);
    }
  };

  const handleDeleteMemory = async (memoryId: string) => {
    try {
      const updatedMemories = memories.filter(m => m.id !== memoryId);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
      setMemories(updatedMemories);
      setIsReadModalVisible(false);
      setSelectedMemory(null);
    } catch (error) {
      console.error('메모리 삭제 실패:', error);
    }
  };

  // 중요 표시 토글
  const handleToggleImportant = async (memoryId: string) => {
    try {
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

  const openReadModal = (memory: Memory) => {
    setSelectedMemory(memory);
    setIsReadModalVisible(true);
  };

  const openWriteModal = () => {
    setNewMemoryText('');
    setNewMemoryIsImportant(false);
    setIsWriteModalVisible(true);
  };

  debugLog('MapScreen.web.tsx:render', 'MapScreen (web) rendering', { platform: 'web' }, 'B');

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
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>📍 Memory Delivery</Text>
            <Text style={styles.headerSubtitle}>
              {isSimulating ? `🎮 시뮬레이션 (+${Math.round(simulatedOffset * 111000)}m)` : `${memories.length}개의 추억`}
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
          style={[styles.tab, activeFilter === 'important' && styles.tabActive]}
          onPress={() => setActiveFilter('important')}
        >
          <Text style={[styles.tabText, activeFilter === 'important' && styles.tabTextActive]}>
            ⭐ 중요 ({importantCount})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeFilter === 'general' && styles.tabActive]}
          onPress={() => setActiveFilter('general')}
        >
          <Text style={[styles.tabText, activeFilter === 'general' && styles.tabTextActive]}>
            일반 ({generalCount})
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
                const isUnlocked = distance < PROXIMITY_THRESHOLD;

                return (
                  <TouchableOpacity
                    key={memory.id}
                    style={[
                      styles.stickyNote,
                      {
                        backgroundColor: isUnlocked ? memory.color : '#D0D0D0',
                        transform: [{ rotate: `${memory.rotation}deg` }],
                        width: NOTE_SIZE,
                        height: NOTE_SIZE,
                      },
                    ]}
                    onPress={() => openReadModal(memory)}
                    activeOpacity={0.8}
                  >
                    {/* 핀 - 중요한 메모는 빨간 핀, 아니면 일반 핀 */}
                    <View style={styles.pinContainer}>
                      <Text style={styles.pinIcon}>{memory.isImportant ? '📍' : '📌'}</Text>
                    </View>

                    {/* 중요 표시 별 */}
                    {memory.isImportant && (
                      <View style={styles.starBadge}>
                        <Text style={styles.starIcon}>⭐</Text>
                      </View>
                    )}

                    {/* 잠금 스티커 */}
                    {!isUnlocked && (
                      <View style={styles.lockSticker}>
                        <Text style={styles.lockIcon}>🔒</Text>
                      </View>
                    )}

                    {/* 내용 */}
                    <View style={styles.noteContent}>
                      {isUnlocked ? (
                        <Text style={styles.noteText} numberOfLines={3}>{memory.text}</Text>
                      ) : (
                        <Text style={styles.lockedText}>Visit to unlock!</Text>
                      )}
                    </View>

                    {/* 거리 */}
                    <Text style={styles.distanceBadge}>📍 {formatDistance(distance)}</Text>
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
              const isUnlocked = distance < PROXIMITY_THRESHOLD;
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
                        {memory.isImportant && <span style={{ marginRight: '4px' }}>⭐</span>}
                        {isUnlocked 
                          ? (memory.text.length > 30 ? memory.text.substring(0, 30) + '...' : memory.text)
                          : '🔒 잠긴 메모리'
                        }
                      </div>
                      
                      {/* 거리 */}
                      <div style={{ 
                        fontSize: '13px', 
                        color: '#666',
                        marginBottom: '8px'
                      }}>
                        📍 {formatDistance(distance)} away
                      </div>
                      
                      {/* 상태 메시지 */}
                      <div style={{ 
                        fontSize: '13px',
                        padding: '8px',
                        borderRadius: '8px',
                        backgroundColor: isUnlocked ? '#E8F5E9' : '#FFF3E0',
                        textAlign: 'center',
                        marginBottom: '8px'
                      }}>
                        {isUnlocked 
                          ? '✨ Tap to read' 
                          : '🔒 Move closer to read'
                        }
                      </div>
                      
                      {/* 읽기 버튼 (잠금 해제된 경우) */}
                      {isUnlocked && (
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
          
          {/* 지도 위 필터된 메모리 카운트 */}
          <View style={styles.mapOverlayInfo}>
            <Text style={styles.mapOverlayText}>
              {filteredMemories.length}개의 추억이 지도에 표시됨
            </Text>
          </View>
        </View>
      )}

      {/* FAB (Floating Action Button) */}
      <TouchableOpacity 
        style={styles.fab} 
        onPress={openWriteModal}
        activeOpacity={0.8}
      >
        <Text style={styles.fabIcon}>✏️</Text>
      </TouchableOpacity>

      {/* 작성 모달 */}
      <Modal
        visible={isWriteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsWriteModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsWriteModalVisible(false)}>
          <Pressable style={[styles.modalNote, { backgroundColor: '#FFF7D1' }]} onPress={() => {}}>
            <View style={styles.modalPinContainer}>
              <Text style={styles.modalPin}>{newMemoryIsImportant ? '📍' : '📌'}</Text>
            </View>
            
            <Text style={styles.modalTitle}>새로운 추억 ✨</Text>
            
            <TextInput
              style={styles.modalInput}
              placeholder="여기에 추억을 남겨주세요..."
              placeholderTextColor="#a89f6a"
              value={newMemoryText}
              onChangeText={setNewMemoryText}
              multiline
              autoFocus
            />

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
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsWriteModalVisible(false)}>
                <Text style={styles.cancelBtnText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveMemory}>
                <Text style={styles.saveBtnText}>📌 Stick it!</Text>
              </TouchableOpacity>
            </View>
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
              style={[styles.modalNote, { backgroundColor: selectedMemory.color }]} 
              onPress={() => {}}
            >
              <View style={styles.modalPinContainer}>
                <Text style={styles.modalPin}>{selectedMemory.isImportant ? '📍' : '📌'}</Text>
              </View>

              {/* 상단 버튼들 */}
              <View style={styles.modalTopButtons}>
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
              </View>
              
              {(() => {
                const distance = getDistanceFromLatLonInMeters(currentLat, currentLon, selectedMemory.latitude, selectedMemory.longitude);
                const isUnlocked = distance < PROXIMITY_THRESHOLD;
                
                return (
                  <>
                    <View style={styles.modalContent}>
                      {isUnlocked ? (
                        <Text style={styles.modalText}>{selectedMemory.text}</Text>
                      ) : (
                        <>
                          <Text style={styles.modalLockedIcon}>🔒</Text>
                          <Text style={styles.modalLockedText}>이 장소를 방문하면 추억이 열립니다!</Text>
                        </>
                      )}
                    </View>
                    
                    <View style={styles.modalFooter}>
                      <Text style={styles.modalDate}>🕐 {selectedMemory.date}</Text>
                      <Text style={styles.modalDistance}>📍 {formatDistance(distance)}</Text>
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
  modalPinContainer: {
    position: 'absolute',
    top: -12,
    alignSelf: 'center',
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
});
