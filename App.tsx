import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Alert, Platform } from 'react-native';
import * as Location from 'expo-location';
import { LocationObject } from 'expo-location';

import MapScreen from './components/MapScreen';
import LoadingScreen from './components/LoadingScreen';
import PermissionDenied from './components/PermissionDenied';

// 지오펜싱 서비스 임포트 (Task 정의가 포함됨 - 반드시 최상위에서 임포트)
import { 
  registerAllGeofences, 
  requestNotificationPermission,
  getGeofencingStatus 
} from './services/GeofencingService';

// #region agent log
const debugLog = (location: string, message: string, data: object, hypothesisId: string) => {
  fetch('http://127.0.0.1:7242/ingest/0595a1ca-db13-40a1-91db-65b59f7fff34',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location,message,data,timestamp:Date.now(),sessionId:'debug-session',hypothesisId})}).catch(()=>{});
};
// #endregion

type AppState = 'loading' | 'granted' | 'denied';

export default function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [location, setLocation] = useState<LocationObject | null>(null);
  const [backgroundPermissionGranted, setBackgroundPermissionGranted] = useState(false);

  // #region agent log
  useEffect(() => {
    debugLog('App.tsx:init', 'App component mounted', { appState }, 'D');
  }, []);
  // #endregion

  /**
   * 위치 권한 요청 (Foreground + Background)
   */
  const requestLocationPermission = async () => {
    debugLog('App.tsx:requestLocationPermission', 'Starting permission request', {}, 'C');
    setAppState('loading');
    
    try {
      // 1. Foreground 위치 권한 요청
      const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
      debugLog('App.tsx:permissionResult', 'Foreground permission result', { foregroundStatus }, 'C');
      
      if (foregroundStatus !== 'granted') {
        setAppState('denied');
        return;
      }

      // 2. 현재 위치 가져오기
      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      debugLog('App.tsx:locationResult', 'Location received', { 
        lat: currentLocation.coords.latitude, 
        lng: currentLocation.coords.longitude 
      }, 'E');
      
      setLocation(currentLocation);
      setAppState('granted');

      // 3. 네이티브 플랫폼에서만 백그라운드 권한 요청
      if (Platform.OS !== 'web') {
        await requestBackgroundPermissions();
      }

    } catch (error) {
      debugLog('App.tsx:error', 'Error in requestLocationPermission', { error: String(error) }, 'C');
      console.error('Error getting location:', error);
      setAppState('denied');
    }
  };

  /**
   * 백그라운드 위치 권한 요청 및 지오펜싱 초기화
   */
  const requestBackgroundPermissions = async () => {
    try {
      console.log('📍 [App] Requesting background permissions...');

      // 백그라운드 위치 권한 확인
      const { status: currentBackgroundStatus } = await Location.getBackgroundPermissionsAsync();
      
      if (currentBackgroundStatus !== 'granted') {
        // 사용자에게 왜 "Always Allow"가 필요한지 설명
        Alert.alert(
          '🔔 백그라운드 위치 권한 필요',
          'Memory Delivery가 앱이 꺼져있을 때도 근처 추억을 알려드리려면 "항상 허용" 위치 권한이 필요합니다.\n\n다음 권한 요청에서 "항상 허용"을 선택해주세요.',
          [
            {
              text: '나중에',
              style: 'cancel',
              onPress: () => {
                console.log('📍 [App] User declined background permission explanation');
              },
            },
            {
              text: '확인',
              onPress: async () => {
                // 백그라운드 권한 요청
                const { status } = await Location.requestBackgroundPermissionsAsync();
                console.log('📍 [App] Background permission result:', status);
                
                if (status === 'granted') {
                  setBackgroundPermissionGranted(true);
                  await initializeGeofencing();
                } else {
                  Alert.alert(
                    '권한 거부됨',
                    '백그라운드 위치 권한이 거부되었습니다. 앱이 꺼져있을 때 추억 알림을 받을 수 없습니다.\n\n설정에서 위치 권한을 "항상 허용"으로 변경할 수 있습니다.',
                    [{ text: '확인' }]
                  );
                }
              },
            },
          ]
        );
      } else {
        // 이미 백그라운드 권한이 있는 경우
        setBackgroundPermissionGranted(true);
        await initializeGeofencing();
      }

    } catch (error) {
      console.error('📍 [App] Error requesting background permissions:', error);
    }
  };

  /**
   * 지오펜싱 초기화 (알림 권한 + 기존 메모리들 등록)
   */
  const initializeGeofencing = async () => {
    try {
      console.log('🔄 [App] Initializing geofencing...');

      // 알림 권한 요청
      const notificationGranted = await requestNotificationPermission();
      if (!notificationGranted) {
        console.log('⚠️ [App] Notification permission denied');
        Alert.alert(
          '알림 권한 필요',
          '추억 알림을 받으려면 알림 권한이 필요합니다.',
          [{ text: '확인' }]
        );
      }

      // 기존 메모리들에 대한 지오펜스 등록
      await registerAllGeofences();

      // 지오펜싱 상태 확인
      const status = await getGeofencingStatus();
      console.log('✅ [App] Geofencing status:', status);

    } catch (error) {
      console.error('❌ [App] Error initializing geofencing:', error);
    }
  };

  useEffect(() => {
    requestLocationPermission();
  }, []);

  // Render based on app state
  if (appState === 'loading') {
    return (
      <>
        <LoadingScreen />
        <StatusBar style="light" />
      </>
    );
  }

  if (appState === 'denied') {
    return (
      <>
        <PermissionDenied onRetry={requestLocationPermission} />
        <StatusBar style="light" />
      </>
    );
  }

  if (appState === 'granted' && location) {
    return (
      <>
        <MapScreen 
          location={location} 
          backgroundPermissionGranted={backgroundPermissionGranted}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  // Fallback (shouldn't reach here)
  return <LoadingScreen />;
}
