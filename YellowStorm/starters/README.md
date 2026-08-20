# YellowStorm App Builder starters

| Project | Ceph revision | Description |
|---------|---------------|-------------|
| [starter-react-vite-v1](./starter-react-vite-v1) | `starter_react_vite_v1` | Minimal React + Vite (legacy) |
| [starter-react-vite-v3](./starter-react-vite-v3) | `starter_react_vite_v3` | V1 + auth + App Data clients (default) |

## Regenerate V3 from templates

```bash
cd YellowStorm/back
npx ts-node scripts/materialize-starter-v3.ts
node scripts/generate-starter-constants.mjs ../starters/starter-react-vite-v3 starter_react_vite_v3
```

## Publish to Ceph

Requires `CEPH_*` credentials in `YellowStorm/back/.env` or `APImanus/backend/.env`:

```bash
npx ts-node scripts/publish-starter-to-ceph.ts --dir ../starters/starter-react-vite-v3 --revision starter_react_vite_v3
```

## Download V1 from Ceph (reference)

```bash
# Uses Ceph S3 API — see scripts in YellowStorm/back/scripts/
```
