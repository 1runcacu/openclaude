
interface CacheItem<T = any> {
  value: T;
  expireTime: number;
}

class MemoryStore {
  private cache = new Map<string, CacheItem>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly DEFAULT_TTL = 60 * 60 * 1000; // 1小时(毫秒)
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000; // 5分钟清理一次

  constructor() {
    // 启动定期清理任务
    this.startCleanupTimer();
  }

  /**
   * 启动定期清理过期数据的定时器
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, this.CLEANUP_INTERVAL);

    // 防止进程退出时定时器阻塞
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * 清理所有过期的数据
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    this.cache.forEach((item, key) => {
      if (now > item.expireTime) {
        expiredKeys.push(key);
      }
    });

    expiredKeys.forEach(key => {
      this.cache.delete(key);
    });

    // 如果缓存为空，可以考虑停止清理定时器以节省资源
    if (this.cache.size === 0) {
      this.stopCleanupTimer();
    }
  }

  /**
   * 停止清理定时器
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 设置键值对，自动在1小时后过期删除
   * @param key 键名(字符串)
   * @param value 值(任意JSON对象)
   * @param ttl 可选的过期时间(毫秒)，默认1小时
   */
  set<T = any>(key: string, value: T, ttl: number = this.DEFAULT_TTL): void {
    const expireTime = Date.now() + ttl;
    
    const cacheItem: CacheItem<T> = {
      value,
      expireTime
    };

    this.cache.set(key, cacheItem);

    // 如果清理定时器已停止，重新启动
    if (!this.cleanupTimer) {
      this.startCleanupTimer();
    }
  }

  /**
   * 获取指定键的值
   * @param key 键名
   * @returns 值或undefined(如果不存在或已过期)
   */
  get<T = any>(key: string): T | undefined {
    const item = this.cache.get(key);
    
    if (!item) {
      return undefined;
    }

    // 检查是否已过期
    if (Date.now() > item.expireTime) {
      this.delete(key);
      return undefined;
    }

    return item.value as T;
  }

  /**
   * 删除指定键
   * @param key 键名
   * @returns 是否删除成功
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 检查键是否存在且未过期
   * @param key 键名
   * @returns 是否存在
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * 获取指定键的剩余过期时间
   * @param key 键名
   * @returns 剩余时间(毫秒)，如果不存在返回-1
   */
  ttl(key: string): number {
    const item = this.cache.get(key);
    
    if (!item) {
      return -1;
    }

    const remaining = item.expireTime - Date.now();
    return remaining > 0 ? remaining : -1;
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
    this.stopCleanupTimer();
  }

  /**
   * 获取当前缓存的键数量
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 获取所有有效的键
   */
  keys(): string[] {
    const validKeys: string[] = [];
    const now = Date.now();
    
    this.cache.forEach((item, key) => {
      if (now <= item.expireTime) {
        validKeys.push(key);
      } else {
        // 清理过期的键
        this.delete(key);
      }
    });
    
    return validKeys;
  }

  /**
   * 刷新指定键的过期时间(重新设置为1小时)
   * @param key 键名
   * @returns 是否刷新成功
   */
  refresh(key: string): boolean {
    const item = this.cache.get(key);
    
    if (!item || Date.now() > item.expireTime) {
      return false;
    }

    // 重新设置相同的值和新的过期时间
    this.set(key, item.value);
    return true;
  }

  /**
   * 销毁实例，清理所有资源
   */
  destroy(): void {
    this.clear();
    this.stopCleanupTimer();
  }

  /**
   * 手动触发过期数据清理
   */
  cleanup(): void {
    this.cleanupExpired();
  }
}

// 导出单例实例
export const memoryStore = new MemoryStore();

// 也导出类，以便创建多个实例
export { MemoryStore };