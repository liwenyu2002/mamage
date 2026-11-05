export async function hydrateSimilarityPhotos(groups, metas, fetchPhoto, { readOnly = false, signal } = {}) {
  const known = new Map((metas || []).map(photo => [String(photo?.id ?? photo?.photoId ?? photo?.photo_id), photo]));
  const photos = {}, missing = [];
  for (const id of new Set(groups.flat().map(String))) {
    const photo = known.get(id);
    if (photo) photos[id] = { ...photo, id, thumbUrl: photo.thumbSrc || photo.thumbUrl || photo.thumb_url || photo.url,
      url: photo.originalSrc || photo.url || photo.thumbSrc };
    else if (!readOnly) missing.push(id);
  }
  // Most photos are already in the album response. Only fetch absent metadata,
  // with bounded concurrency instead of one request per photo all at once.
  let next = 0;
  const worker = async () => {
    while (next < missing.length) {
      if (signal?.aborted) throw Object.assign(Error('Cancelled'), { name: 'AbortError' });
      const id = missing[next++];
      try { photos[id] = await fetchPhoto(id); }
      catch (error) { if (error.status !== 404) throw error; }
    }
  };
  const workers = Array.from({ length: Math.min(4, missing.length) }, () => worker());
  await Promise.all(workers);
  return photos;
}
