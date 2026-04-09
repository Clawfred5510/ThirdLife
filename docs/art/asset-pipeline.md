# Art & Asset Pipeline

## Asset Types
| Type | Format | Location |
|------|--------|----------|
| 3D Models | .glb / .gltf | assets/models/ |
| Textures | .png / .webp | assets/textures/ |
| Audio | .ogg / .mp3 | assets/audio/ |
| UI Icons | .svg / .png | packages/client/src/assets/ |

## Naming Convention
- Lowercase, hyphen-separated: `building-shop-01.glb`
- Prefix by category: `char-`, `building-`, `prop-`, `env-`, `ui-`
- Include variant number: `-01`, `-02`

## Workflow
1. Create source asset (Blender, image editor, etc.)
2. Export to web-friendly format (.glb, .webp, .ogg)
3. Place in appropriate `assets/` directory
4. Reference in code via Babylon.js asset manager

## Performance Targets
- Individual model: < 10k triangles (LOD0)
- Texture resolution: 512x512 standard, 1024x1024 hero assets
- Total scene draw calls: < 200
- Target frame rate: 60fps on mid-range hardware

## LOD Strategy
- LOD0: Full detail (< 10m from camera)
- LOD1: 50% triangles (10-30m)
- LOD2: 10% triangles (30m+)
- Billboards for distant objects
