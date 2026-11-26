import { loadMappa, meshArrays } from './mappa.js';
import { buildEffects } from './disegno.js';

export async function prepareModel({ size, traffic }, onProgress) {
  const map = await loadMappa(undefined, fraction => onProgress(fraction * 0.6));
  const effects = buildEffects(map, size, traffic, fraction => onProgress(0.6 + fraction * 0.28));
  const meshes = meshArrays({
    ...map,
    objects: map.objects.filter(({ name }) => !/^(calore|rumore)/i.test(name)),
  });
  onProgress(0.94);
  return { effects, meshes };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = async ({ data }) => {
    try {
      const result = await prepareModel(data, progress => self.postMessage({ progress }));
      const transfers = result.meshes.flatMap(mesh => [mesh.pos.buffer, mesh.nor.buffer, mesh.indices.buffer]);
      for (const { atlas, aux1, aux2 } of Object.values(result.effects).filter(value => value?.atlas)) {
        transfers.push(atlas.buffer, aux1.buffer, aux2.buffer);
      }
      self.postMessage({ result }, transfers);
    } catch (error) {
      self.postMessage({ error: error.message });
    }
  };
}
