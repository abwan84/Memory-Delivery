import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// ============================================
// Constants
// ============================================
export const GEOFENCING_TASK = 'MEMORY_GEOFENCING_TASK';
export const STORAGE_KEY = '@memories';
export const GEOFENCE_RADIUS = 100; // meters

// Memory 타입 정의
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

// 알림된 메모리 추적 (중복 알림 방지)
const NOTIFIED_MEMORIES_KEY = '@notified_memories';

// ============================================
// Notification Configuration
// ============================================
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ============================================
// Task Definition (Must be at top level!)
// ============================================
TaskManager.defineTask(GEOFENCING_TASK, async ({ data, error }) => {
  console.log('🔔 [GeofencingTask] Task triggered!');
  
  if (error) {
    console.error('🔔 [GeofencingTask] Error:', error.message);
    return;
  }

  if (data) {
    const { eventType, region } = data as {
      eventType: Location.GeofencingEventType;
      region: Location.LocationRegion;
    };

    console.log('🔔 [GeofencingTask] Event Type:', eventType);
    console.log('🔔 [GeofencingTask] Region:', region);

    // 지오펜스 진입 감지
    if (eventType === Location.GeofencingEventType.Enter) {
      console.log('🔔 [GeofencingTask] ENTERED region:', region.identifier);
      
      try {
        // 이미 알림된 메모리인지 확인
        const notifiedStr = await AsyncStorage.getItem(NOTIFIED_MEMORIES_KEY);
        const notifiedMemories: string[] = notifiedStr ? JSON.parse(notifiedStr) : [];
        
        if (notifiedMemories.includes(region.identifier)) {
          console.log('🔔 [GeofencingTask] Already notified for this memory, skipping...');
          return;
        }

        // 메모리 정보 가져오기
        const memoriesStr = await AsyncStorage.getItem(STORAGE_KEY);
        if (memoriesStr) {
          const memories: Memory[] = JSON.parse(memoriesStr);
          const memory = memories.find(m => m.id === region.identifier);
          
          if (memory) {
            // 알림 표시
            await Notifications.scheduleNotificationAsync({
              content: {
                title: memory.isImportant ? '⭐ 중요한 추억이 근처에!' : '📝 추억이 근처에!',
                body: `"${memory.text.substring(0, 50)}${memory.text.length > 50 ? '...' : ''}"`,
                data: { memoryId: memory.id },
                sound: true,
              },
              trigger: null, // 즉시 표시
            });
            
            console.log('🔔 [GeofencingTask] Notification sent for memory:', memory.id);
            
            // 알림된 메모리로 기록 (24시간 후 초기화 가능하도록)
            notifiedMemories.push(region.identifier);
            await AsyncStorage.setItem(NOTIFIED_MEMORIES_KEY, JSON.stringify(notifiedMemories));
          }
        }
      } catch (err) {
        console.error('🔔 [GeofencingTask] Error processing geofence:', err);
      }
    }
    
    // 지오펜스 이탈 감지 (선택적 로깅)
    if (eventType === Location.GeofencingEventType.Exit) {
      console.log('🔔 [GeofencingTask] EXITED region:', region.identifier);
    }
  }
});

// ============================================
// Permission Helpers
// ============================================

/**
 * 백그라운드 위치 권한 요청 (Always Allow)
 */
export async function requestBackgroundLocationPermission(): Promise<boolean> {
  console.log('📍 [Permissions] Requesting background location permission...');
  
  // 1. 먼저 foreground 권한 확인/요청
  const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
  console.log('📍 [Permissions] Foreground permission:', foregroundStatus);
  
  if (foregroundStatus !== 'granted') {
    console.log('📍 [Permissions] Foreground permission denied');
    return false;
  }

  // 2. 백그라운드 권한 요청
  const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
  console.log('📍 [Permissions] Background permission:', backgroundStatus);
  
  if (backgroundStatus !== 'granted') {
    console.log('📍 [Permissions] Background permission denied');
    return false;
  }

  return true;
}

/**
 * 알림 권한 요청
 */
export async function requestNotificationPermission(): Promise<boolean> {
  console.log('🔔 [Permissions] Requesting notification permission...');
  
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  console.log('🔔 [Permissions] Notification permission:', finalStatus);
  return finalStatus === 'granted';
}

/**
 * 모든 필요한 권한 요청
 */
export async function requestAllPermissions(): Promise<{
  location: boolean;
  background: boolean;
  notification: boolean;
}> {
  // Foreground location
  const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
  const locationGranted = foregroundStatus === 'granted';

  // Background location (native only)
  let backgroundGranted = false;
  if (Platform.OS !== 'web' && locationGranted) {
    const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
    backgroundGranted = backgroundStatus === 'granted';
  }

  // Notifications
  const notificationGranted = await requestNotificationPermission();

  return {
    location: locationGranted,
    background: backgroundGranted,
    notification: notificationGranted,
  };
}

// ============================================
// Geofencing Functions
// ============================================

/**
 * 단일 메모리에 대한 지오펜스 등록
 */
export async function registerGeofenceForMemory(memory: Memory): Promise<void> {
  if (Platform.OS === 'web') {
    console.log('🌐 [Geofencing] Web platform - skipping geofence registration');
    return;
  }

  try {
    // 현재 등록된 지오펜스 가져오기
    const isTaskDefined = await TaskManager.isTaskDefined(GEOFENCING_TASK);
    if (!isTaskDefined) {
      console.error('❌ [Geofencing] Task not defined!');
      return;
    }

    const regions: Location.LocationRegion[] = [{
      identifier: memory.id,
      latitude: memory.latitude,
      longitude: memory.longitude,
      radius: GEOFENCE_RADIUS,
      notifyOnEnter: true,
      notifyOnExit: false,
    }];

    // 기존 지오펜스에 추가
    const hasStarted = await Location.hasStartedGeofencingAsync(GEOFENCING_TASK);
    
    if (hasStarted) {
      // 기존 지오펜스 가져와서 새 것 추가
      const existingRegions = await getRegisteredGeofences();
      const allRegions = [...existingRegions.filter(r => r.identifier !== memory.id), ...regions];
      await Location.startGeofencingAsync(GEOFENCING_TASK, allRegions);
    } else {
      await Location.startGeofencingAsync(GEOFENCING_TASK, regions);
    }

    console.log('✅ [Geofencing] Registered geofence for memory:', memory.id);
  } catch (error) {
    console.error('❌ [Geofencing] Error registering geofence:', error);
  }
}

/**
 * 모든 메모리에 대한 지오펜스 등록 (앱 시작 시)
 */
export async function registerAllGeofences(): Promise<void> {
  if (Platform.OS === 'web') {
    console.log('🌐 [Geofencing] Web platform - skipping geofence registration');
    return;
  }

  try {
    console.log('🔄 [Geofencing] Registering all geofences...');

    // 백그라운드 권한 확인
    const { status } = await Location.getBackgroundPermissionsAsync();
    if (status !== 'granted') {
      console.log('⚠️ [Geofencing] Background permission not granted, skipping...');
      return;
    }

    // 저장된 메모리 가져오기
    const memoriesStr = await AsyncStorage.getItem(STORAGE_KEY);
    if (!memoriesStr) {
      console.log('📭 [Geofencing] No memories found');
      return;
    }

    const memories: Memory[] = JSON.parse(memoriesStr);
    if (memories.length === 0) {
      console.log('📭 [Geofencing] No memories to register');
      return;
    }

    // 지역 배열 생성
    const regions: Location.LocationRegion[] = memories.map(memory => ({
      identifier: memory.id,
      latitude: memory.latitude,
      longitude: memory.longitude,
      radius: GEOFENCE_RADIUS,
      notifyOnEnter: true,
      notifyOnExit: false,
    }));

    // 지오펜싱 시작
    await Location.startGeofencingAsync(GEOFENCING_TASK, regions);
    console.log(`✅ [Geofencing] Registered ${regions.length} geofences`);
    
  } catch (error) {
    console.error('❌ [Geofencing] Error registering all geofences:', error);
  }
}

/**
 * 특정 메모리의 지오펜스 제거
 */
export async function unregisterGeofenceForMemory(memoryId: string): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const hasStarted = await Location.hasStartedGeofencingAsync(GEOFENCING_TASK);
    if (!hasStarted) return;

    const existingRegions = await getRegisteredGeofences();
    const filteredRegions = existingRegions.filter(r => r.identifier !== memoryId);

    if (filteredRegions.length === 0) {
      await Location.stopGeofencingAsync(GEOFENCING_TASK);
    } else {
      await Location.startGeofencingAsync(GEOFENCING_TASK, filteredRegions);
    }

    console.log('✅ [Geofencing] Unregistered geofence for memory:', memoryId);
  } catch (error) {
    console.error('❌ [Geofencing] Error unregistering geofence:', error);
  }
}

/**
 * 모든 지오펜스 중지
 */
export async function stopAllGeofencing(): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const hasStarted = await Location.hasStartedGeofencingAsync(GEOFENCING_TASK);
    if (hasStarted) {
      await Location.stopGeofencingAsync(GEOFENCING_TASK);
      console.log('🛑 [Geofencing] Stopped all geofencing');
    }
  } catch (error) {
    console.error('❌ [Geofencing] Error stopping geofencing:', error);
  }
}

/**
 * 등록된 지오펜스 목록 가져오기
 */
async function getRegisteredGeofences(): Promise<Location.LocationRegion[]> {
  try {
    // expo-location doesn't have a direct API to get registered regions
    // So we'll read from storage
    const memoriesStr = await AsyncStorage.getItem(STORAGE_KEY);
    if (!memoriesStr) return [];

    const memories: Memory[] = JSON.parse(memoriesStr);
    return memories.map(memory => ({
      identifier: memory.id,
      latitude: memory.latitude,
      longitude: memory.longitude,
      radius: GEOFENCE_RADIUS,
      notifyOnEnter: true,
      notifyOnExit: false,
    }));
  } catch {
    return [];
  }
}

/**
 * 알림된 메모리 기록 초기화 (디버깅/테스트용)
 */
export async function clearNotifiedMemories(): Promise<void> {
  await AsyncStorage.removeItem(NOTIFIED_MEMORIES_KEY);
  console.log('🧹 [Geofencing] Cleared notified memories');
}

/**
 * 지오펜싱 상태 확인
 */
export async function getGeofencingStatus(): Promise<{
  isTaskDefined: boolean;
  isRunning: boolean;
  backgroundPermission: string;
}> {
  if (Platform.OS === 'web') {
    return {
      isTaskDefined: false,
      isRunning: false,
      backgroundPermission: 'web-not-supported',
    };
  }

  const isTaskDefined = await TaskManager.isTaskDefined(GEOFENCING_TASK);
  const isRunning = await Location.hasStartedGeofencingAsync(GEOFENCING_TASK).catch(() => false);
  const { status } = await Location.getBackgroundPermissionsAsync();

  return {
    isTaskDefined,
    isRunning,
    backgroundPermission: status,
  };
}
