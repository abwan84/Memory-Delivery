import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';

interface PermissionDeniedProps {
  onRetry: () => void;
}

export default function PermissionDenied({ onRetry }: PermissionDeniedProps) {
  const handleOpenSettings = async () => {
    // On mobile, this will prompt the user again or guide them to settings
    onRetry();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>📍</Text>
      <Text style={styles.title}>Permission Needed</Text>
      <Text style={styles.message}>
        Memory Delivery needs access to your location to save memories at specific places.
      </Text>
      <TouchableOpacity style={styles.button} onPress={handleOpenSettings}>
        <Text style={styles.buttonText}>Grant Permission</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f23',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f0f0f0',
    marginBottom: 12,
  },
  message: {
    fontSize: 16,
    color: '#a0a0b0',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  button: {
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});

