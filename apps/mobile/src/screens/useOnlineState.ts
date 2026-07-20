import { onlineManager } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export function useOnlineState(): boolean {
  const [online, setOnline] = useState(onlineManager.isOnline() !== false);

  useEffect(() => onlineManager.subscribe(setOnline), []);
  return online;
}
