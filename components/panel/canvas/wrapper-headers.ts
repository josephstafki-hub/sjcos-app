/** Trusted viewers only. Never apply frame DENY to /api/canvas renderer children. */
export const canvasWrapperHeaders={
 'Content-Security-Policy':"frame-ancestors 'none'",
 'X-Frame-Options':'DENY',
 'Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff',
 'Cache-Control':'private, no-store',
};
