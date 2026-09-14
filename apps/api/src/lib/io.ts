import type { Server } from 'socket.io'
let io: Server | null = null
/** Set once at startup; route handlers emit through getIo() so app.ts stays importable in tests without a server. */
export const setIo = (s: Server) => { io = s }
export const getIo = () => io
