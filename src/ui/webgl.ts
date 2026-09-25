let webglSupport: boolean | undefined;

/**
 * Can this browser create a WebGL context at all? Checked once; the probe context is released so it does not
 * count against the browser's context limit. 3D views show a text fallback instead of crashing without it.
 */
export function hasWebGL(): boolean {
  if (webglSupport !== undefined) return webglSupport;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    webglSupport = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}
