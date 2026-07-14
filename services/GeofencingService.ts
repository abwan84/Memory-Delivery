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
export const GEOFENCE_RADIUS_OPTIONS = [50, 100, 200] as const;
export type GeofenceRadius = typeof GEOFENCE_RADIUS_OPTIONS[number];
export const REENTRY_BUFFER_METERS = 50;
export type NotificationRepeatMode = 'repeat' | 'once';
export const DEFAULT_NOTIFICATION_REPEAT_MODE: NotificationRepeatMode = 'repeat';
const ARRIVAL_NOTIFICATION_CHANNEL = 'memory-arrivals';
const LEGACY_NOTIFIED_MEMORIES_KEY = '@notified_memories';
const ARRIVAL_NOTIFICATION_STATES_KEY = '@arrival_notification_states_v2';

type ArrivalNotificationState = {
  status: 'cooldown' | 'completed';
  hasDelivered: boolean;
};

type ArrivalNotificationStates = Record<string, ArrivalNotificationState>;
let arrivalStateQueue: Promise<void> = Promise.resolve();

// Memory 타입 정의
export interface GeofencedMemory {
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
}

function getMemoryRadius(memory: GeofencedMemory): GeofenceRadius {
  return GEOFENCE_RADIUS_OPTIONS.includes(memory.notificationRadius as GeofenceRadius)
    ? memory.notificationRadius as GeofenceRadius
    : GEOFENCE_RADIUS;
}

export function getNotificationRepeatMode(memory: GeofencedMemory): NotificationRepeatMode {
  return memory.notificationRepeatMode === 'once'
    ? 'once'
    : DEFAULT_NOTIFICATION_REPEAT_MODE;
}

export function isArrivalNotificationEnabled(memory: GeofencedMemory): boolean {
  return memory.arrivalNotificationEnabled !== false;
}

function getReentryRadius(memory: GeofencedMemory): number {
  return getMemoryRadius(memory) + REENTRY_BUFFER_METERS;
}

async function writeArrivalNotificationStates(states: ArrivalNotificationStates): Promise<void> {
  await AsyncStorage.setItem(ARRIVAL_NOTIFICATION_STATES_KEY, JSON.stringify(states));
}

async function readArrivalNotificationStates(): Promise<ArrivalNotificationStates> {
  const stored = await AsyncStorage.getItem(ARRIVAL_NOTIFICATION_STATES_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as ArrivalNotificationStates;
    } catch {
      await AsyncStorage.removeItem(ARRIVAL_NOTIFICATION_STATES_KEY);
    }
  }

  const legacyStored = await AsyncStorage.getItem(LEGACY_NOTIFIED_MEMORIES_KEY);
  if (!legacyStored) return {};

  try {
    const legacyIds = JSON.parse(legacyStored) as string[];
    const migrated = legacyIds.reduce<ArrivalNotificationStates>((states, memoryId) => {
      states[memoryId] = { status: 'cooldown', hasDelivered: true };
      return states;
    }, {});
    await writeArrivalNotificationStates(migrated);
    await AsyncStorage.removeItem(LEGACY_NOTIFIED_MEMORIES_KEY);
    return migrated;
  } catch {
    await AsyncStorage.removeItem(LEGACY_NOTIFIED_MEMORIES_KEY);
    return {};
  }
}

function buildRegion(
  memory: GeofencedMemory,
  states: ArrivalNotificationStates
): Location.LocationRegion {
  const state = states[memory.id];
  const isWaitingForExit = state?.status === 'cooldown';

  return {
    identifier: memory.id,
    latitude: memory.latitude,
    longitude: memory.longitude,
    radius: isWaitingForExit ? getReentryRadius(memory) : getMemoryRadius(memory),
    notifyOnEnter: state?.status !== 'completed',
    notifyOnExit: isWaitingForExit,
  };
}

function buildRegions(
  memories: GeofencedMemory[],
  states: ArrivalNotificationStates
): Location.LocationRegion[] {
  return memories
    .filter(memory =>
      isArrivalNotificationEnabled(memory) &&
      states[memory.id]?.status !== 'completed'
    )
    .map(memory => buildRegion(memory, states));
}

async function replaceRegisteredGeofences(
  memories: GeofencedMemory[],
  states: ArrivalNotificationStates
): Promise<void> {
  if (Platform.OS === 'web') return;

  const regions = buildRegions(memories, states);
  const hasStarted = await Location.hasStartedGeofencingAsync(GEOFENCING_TASK);

  if (regions.length === 0) {
    if (hasStarted) await Location.stopGeofencingAsync(GEOFENCING_TASK);
    return;
  }

  await Location.startGeofencingAsync(GEOFENCING_TASK, regions);
}

function getDistanceInMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
): number {
  const earthRadius = 6371000;
  const toRadians = (degrees: number) => degrees * (Math.PI / 180);
  const latitudeDelta = toRadians(latitudeB - latitudeA);
  const longitudeDelta = toRadians(longitudeB - longitudeA);
  const startLatitude = toRadians(latitudeA);
  const endLatitude = toRadians(latitudeB);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function runArrivalStateOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = arrivalStateQueue.then(operation, operation);
  arrivalStateQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function refreshGeofencesIfRunning(
  memories: GeofencedMemory[],
  states: ArrivalNotificationStates
): Promise<void> {
  if (Platform.OS === 'web') return;
  const hasStarted = await Location.hasStartedGeofencingAsync(GEOFENCING_TASK).catch(() => false);
  if (hasStarted) await replaceRegisteredGeofences(memories, states);
}

export async function prepareMemoryNotificationState(
  memory: GeofencedMemory,
  currentDistance: number
): Promise<void> {
  await runArrivalStateOperation(async () => {
    const states = await readArrivalNotificationStates();

    if (!isArrivalNotificationEnabled(memory)) {
      if (states[memory.id]) {
        delete states[memory.id];
        await writeArrivalNotificationStates(states);
      }
      return;
    }

    const existing = states[memory.id];
    const repeatMode = getNotificationRepeatMode(memory);

    if (repeatMode === 'once' && existing?.hasDelivered) {
      states[memory.id] = { status: 'completed', hasDelivered: true };
    } else if (repeatMode === 'repeat' && existing?.status === 'completed') {
      states[memory.id] = { status: 'cooldown', hasDelivered: true };
    } else if (currentDistance < getReentryRadius(memory) && !existing) {
      states[memory.id] = { status: 'cooldown', hasDelivered: false };
    } else if (currentDistance >= getReentryRadius(memory) && existing?.status === 'cooldown') {
      delete states[memory.id];
    }

    await writeArrivalNotificationStates(states);
  });
}

export async function claimForegroundArrivalNotifications(
  memories: GeofencedMemory[],
  currentLatitude: number,
  currentLongitude: number
): Promise<GeofencedMemory[]> {
  return runArrivalStateOperation(async () => {
    const states = await readArrivalNotificationStates();
    const claimed: GeofencedMemory[] = [];
    let changed = false;

    for (const memory of memories) {
      if (!isArrivalNotificationEnabled(memory)) {
        if (states[memory.id]) {
          delete states[memory.id];
          changed = true;
        }
        continue;
      }

      const distance = getDistanceInMeters(
        currentLatitude,
        currentLongitude,
        memory.latitude,
        memory.longitude
      );
      const state = states[memory.id];

      if (state?.status === 'cooldown' && distance >= getReentryRadius(memory)) {
        delete states[memory.id];
        changed = true;
        continue;
      }

      if (!state && distance < getMemoryRadius(memory)) {
        states[memory.id] = getNotificationRepeatMode(memory) === 'once'
          ? { status: 'completed', hasDelivered: true }
          : { status: 'cooldown', hasDelivered: true };
        claimed.push(memory);
        changed = true;
      }
    }

    if (changed) {
      await writeArrivalNotificationStates(states);
      await refreshGeofencesIfRunning(memories, states);
    }

    return claimed;
  });
}

export async function removeMemoryNotificationState(memoryId: string): Promise<void> {
  await runArrivalStateOperation(async () => {
    const states = await readArrivalNotificationStates();
    if (!states[memoryId]) return;
    delete states[memoryId];
    await writeArrivalNotificationStates(states);
  });
}

export async function sendArrivalNotification(memory: GeofencedMemory): Promise<void> {
  if (!isArrivalNotificationEnabled(memory)) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: memory.isImportant ? '중요한 위치 메모에 도착했어요' : '위치 메모에 도착했어요',
      body: `"${memory.text.substring(0, 50)}${memory.text.length > 50 ? '...' : ''}"`,
      data: { memoryId: memory.id },
      sound: true,
    },
    trigger: Platform.OS === 'android'
      ? { channelId: ARRIVAL_NOTIFICATION_CHANNEL }
      : null,
  });
}

// 알림된 메모리 추적 (중복 알림 방지)
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
      const regionId = region.identifier;

      if (!regionId) {
        console.warn('🔔 [GeofencingTask] Region identifier is missing');
        return;
      }
      
      try {
        // 이미 알림된 메모리인지 확인
        const states = await readArrivalNotificationStates();
        
        if (states[regionId]) {
          console.log('🔔 [GeofencingTask] Already notified for this memory, skipping...');
          return;
        }

        // 메모리 정보 가져오기
        const memoriesStr = await AsyncStorage.getItem(STORAGE_KEY);
        if (memoriesStr) {
          const memories: GeofencedMemory[] = JSON.parse(memoriesStr);
          const memory = memories.find(m => m.id === regionId);
          
          if (memory) {
            if (!isArrivalNotificationEnabled(memory)) {
              await replaceRegisteredGeofences(memories, states);
              return;
            }

            states[regionId] = getNotificationRepeatMode(memory) === 'once'
              ? { status: 'completed', hasDelivered: true }
              : { status: 'cooldown', hasDelivered: true };
            await writeArrivalNotificationStates(states);
            try {
              await sendArrivalNotification(memory);
            } catch (notificationError) {
              delete states[regionId];
              await writeArrivalNotificationStates(states);
              throw notificationError;
            }
            
            console.log('🔔 [GeofencingTask] Notification sent for memory:', memory.id);
            
            // 알림된 메모리로 기록 (24시간 후 초기화 가능하도록)
            await replaceRegisteredGeofences(memories, states);
          }
        }
      } catch (err) {
        console.error('🔔 [GeofencingTask] Error processing geofence:', err);
      }
    }
    
    // 지오펜스 이탈 감지 (선택적 로깅)
    if (eventType === Location.GeofencingEventType.Exit) {
      console.log('🔔 [GeofencingTask] EXITED region:', region.identifier);
      const regionId = region.identifier;

      if (regionId) {
        try {
          const states = await readArrivalNotificationStates();
          if (states[regionId]?.status !== 'cooldown') return;

          delete states[regionId];
          await writeArrivalNotificationStates(states);

          const memoriesStr = await AsyncStorage.getItem(STORAGE_KEY);
          const memories: GeofencedMemory[] = memoriesStr ? JSON.parse(memoriesStr) : [];
          await replaceRegisteredGeofences(memories, states);
        } catch (err) {
          console.error('🔔 [GeofencingTask] Error resetting notification state:', err);
        }
      }
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

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ARRIVAL_NOTIFICATION_CHANNEL, {
      name: '도착 알림',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  
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
export async function registerGeofenceForMemory(memory: GeofencedMemory): Promise<void> {
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

    const states = await readArrivalNotificationStates();
    const regions = buildRegions([memory], states);

    // 기존 지오펜스에 추가
    const hasStarted = await Location.hasStartedGeofencingAsync(GEOFENCING_TASK);
    
    if (hasStarted) {
      // 기존 지오펜스 가져와서 새 것 추가
      const existingRegions = await getRegisteredGeofences();
      const allRegions = [...existingRegions.filter(r => r.identifier !== memory.id), ...regions];
      if (allRegions.length === 0) {
        await Location.stopGeofencingAsync(GEOFENCING_TASK);
      } else {
        await Location.startGeofencingAsync(GEOFENCING_TASK, allRegions);
      }
    } else if (regions.length > 0) {
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

    const memories: GeofencedMemory[] = JSON.parse(memoriesStr);
    if (memories.length === 0) {
      console.log('📭 [Geofencing] No memories to register');
      return;
    }

    // 지역 배열 생성
    const states = await readArrivalNotificationStates();
    const regions = buildRegions(memories, states);

    // 지오펜싱 시작
    await replaceRegisteredGeofences(memories, states);
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
    await removeMemoryNotificationState(memoryId);
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

    const memories: GeofencedMemory[] = JSON.parse(memoriesStr);
    const states = await readArrivalNotificationStates();
    return buildRegions(memories, states);
  } catch {
    return [];
  }
}

/**
 * 알림된 메모리 기록 초기화 (디버깅/테스트용)
 */
export async function clearNotifiedMemories(): Promise<void> {
  await AsyncStorage.multiRemove([
    ARRIVAL_NOTIFICATION_STATES_KEY,
    LEGACY_NOTIFIED_MEMORIES_KEY,
  ]);
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
