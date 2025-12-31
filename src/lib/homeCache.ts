import { getConfig } from './config'

export type CloudflareEnv = {
  kv_cache: any
}

export function getKV(env: any): any | null {
  if (!env) {
    // 尝试从全局 process.env 获取
    env = typeof process !== 'undefined' ? process.env : {};
  }

  const candidates = ['kv_cache', 'KV_CACHE', 'kv', 'KV'];

  // 1. 从传入的 env 或 process.env 查找
  for (const key of candidates) {
    const kv = env[key];
    if (kv && typeof kv.get === 'function' && typeof kv.put === 'function') {
      return kv;
    }
  }

  // 2. 从 globalThis 查找
  const g = globalThis as any;
  for (const key of candidates) {
    const kv = g[key];
    if (kv && typeof kv.get === 'function' && typeof kv.put === 'function') {
      return kv;
    }
  }

  // 3. 遍历所有键寻找可能是 KV 的对象
  const allEnv = { ...env, ...g };
  const keys = Object.keys(allEnv);
  for (const key of keys) {
    const kv = allEnv[key];
    if (
      kv &&
      typeof kv === 'object' &&
      typeof kv.get === 'function' &&
      typeof kv.put === 'function'
    ) {
      return kv;
    }
  }

  // 4. 只有在存储类型是 kv 时才输出错误日志，避免干扰 d1 模式
  const storageType = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_STORAGE_TYPE : 'unknown';
  if (storageType === 'kv') {
    console.error(`[getKV] No KV binding found. 
      - Available Env Keys: ${Object.keys(env).join(', ')}
      - Available Global Keys: ${Object.keys(g).filter(k => !k.startsWith('_')).join(', ')}
    `);
  }

  return null;
}

export const HOME_KEY = 'home:index'
export const CACHE_TTL = 300 // 秒，5 分钟
export const REFRESH_INTERVAL = 180 // 秒，后台刷新 KV

let refreshTimer: any | null = null

/**
 * 获取首页数据（KV 优先）
 */
export async function getHome(env: CloudflareEnv): Promise<any> {
  const storageType = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_STORAGE_TYPE : 'unknown';

  try {
    // 1. 如果是 KV 模式，优先从 KV 获取
    if (storageType === 'kv') {
      const kv = getKV(env)
      if (kv) {
        const cached = await kv.get(HOME_KEY)
        if (cached) return JSON.parse(cached)
      }
    }

    // 2. 从源数据获取
    const homeData = await fetchHomeFromSource()

    // 3. 如果有 KV 绑定，顺便更新缓存（不论什么模式）
    const kv = getKV(env)
    if (kv) {
      await kv.put(HOME_KEY, JSON.stringify(homeData), { expirationTtl: CACHE_TTL })
    }

    return homeData
  } catch (err) {
    console.error('[getHome] error:', err)

    // 降级逻辑：尝试最后一次读取 KV
    const kv = getKV(env)
    if (kv) {
      const cached = await kv.get(HOME_KEY)
      if (cached) return JSON.parse(cached)
    }

    return { siteName: 'MoonTV', announcement: '', categories: [], sources: [] }
  }
}

/**
 * 从源数据获取首页数据
 */
export async function fetchHomeFromSource(): Promise<any> {
  const config = await getConfig()
  return {
    siteName: config.SiteConfig.SiteName,
    announcement: config.SiteConfig.Announcement,
    categories: config.CustomCategories,
    sources: config.SourceConfig.filter((s) => !s.disabled),
  }
}

/**
 * 启动后台自动刷新 KV
 */
export function startAutoRefresh(env: CloudflareEnv) {
  if (refreshTimer) return

  const refreshFn = async () => {
    try {
      const homeData = await fetchHomeFromSource()
      const kv = getKV(env)
      if (kv) {
        await kv.put(HOME_KEY, JSON.stringify(homeData), { expirationTtl: CACHE_TTL })
      }
      console.log('[HomeCache] KV refreshed')
    } catch (err) {
      console.error('[HomeCache] KV refresh failed:', err)
    }
  }

  // 立即刷新一次
  refreshFn()

  // 设置定时刷新
  refreshTimer = setInterval(refreshFn, REFRESH_INTERVAL * 1000)
}
