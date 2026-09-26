/** Route paths (hash-based so the app works on any static host). */
export const routes = {
  home: '/',
  campaign: '/campaign',
  mission: (id: string) => `/mission/${encodeURIComponent(id)}`,
  sandbox: (sceneId?: string) => (sceneId ? `/sandbox/${encodeURIComponent(sceneId)}` : '/sandbox'),
  showroom: (device?: string) => (device ? `/showroom/${encodeURIComponent(device)}` : '/showroom'),
  reference: (mnemonic?: string) => (mnemonic ? `/reference/${encodeURIComponent(mnemonic)}` : '/reference'),
  profile: '/profile',
} as const;
