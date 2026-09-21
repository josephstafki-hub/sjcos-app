# 3D scene (components/floor/scene)

Coordinates: the plan is inches with y DOWN on screen. World is also inches:
plan (x, y) → world (x, 0, y); heights go on world y (level elevation + z).
So +world z is "south" (bottom of the 2D sheet). A plan rotation `rotDeg`
(clockwise on screen) becomes `rotation.y = -rotDeg` in radians (`yawFromPlanDeg`);
at rotDeg 0 an item's front is +local z = +world z.

Everything derives from the PlanDoc on each render (memoised, keyed by id).
`Scene3D.tsx` filters by level + phase and composes the pieces here; `Cameras.tsx`
owns orbit / walk / plan + fly / fit; `Bridge.tsx` exposes the renderer for capture.

To add an item look: extend `flavor()` in `Items.tsx` (keyword → sub-type) and add a
branch in `<ItemMesh>` / `<Appliance>` / `<Fixture>` built from `<Box>` + `<Surface>`.
Use `Surface` for every material so white / wireframe / sketch styles keep working.
