/** Обёртка над fetch для API «Такта».
 *  Бросает ApiError с русским текстом ошибки из бэка — отдельный показ в UI.
 */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch { /* тело не JSON — оставим пустым */ }
  if (!res.ok) {
    const err = new Error(data.error || 'Ошибка запроса');
    err.status = res.status;
    throw err;
  }
  return data;
}
