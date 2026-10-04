import { z } from 'zod'
/** GET/PUT/DELETE /me/list: this device's My list as title slugs, newest first, published titles only. */
export const MyList = z.object({ slugs: z.array(z.string()) })
export type MyList = z.infer<typeof MyList>
