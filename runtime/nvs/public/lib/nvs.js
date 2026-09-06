(() => {
  const script = document.currentScript;
  const propertyId = script?.dataset?.propertyId || '';
  const allowed = new Set(['page_view', 'vsl_progress']);
  const eventId = () => `nvs_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const send = (eventName, data = {}) => {
    if (!allowed.has(eventName) || !propertyId) {
      console.warn('NVS public tracking accepts only configured non-commercial events.');
      return false;
    }
    const payload = { property_id: propertyId, tracking_event_id: eventId(), event_name: eventName };
    if (eventName === 'vsl_progress' && Number.isFinite(data.progress)) payload.params = { progress: data.progress };
    navigator.sendBeacon('/ingest.php', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    return true;
  };
  window.nvs = Object.freeze({ track: send });
})();
