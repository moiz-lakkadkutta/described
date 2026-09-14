import type { Server } from 'socket.io'
/** Described has no phone companion; sockets carry pipeline progress to the admin page only. */
export function registerSockets(io: Server) {
  io.on('connection', (s) => { s.on('admin:watch', (titleId: string) => s.join(`title:${titleId}`)) })
}
export const progressRoom = (titleId: string) => `title:${titleId}`
