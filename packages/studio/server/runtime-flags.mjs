function enabled(environment, name) {
  return environment?.[name] === 'true';
}

export function readRuntimeFlags(environment = process.env) {
  return Object.freeze({
    umamiRuntime: enabled(environment, 'UMAMI_RUNTIME_ENABLED'),
    nvsRuntime: enabled(environment, 'NVS_RUNTIME_ENABLED'),
    pixels: enabled(environment, 'PIXELS_ENABLED'),
    mediaPipeline: enabled(environment, 'MEDIA_PIPELINE_ENABLED'),
    billingEnforcement: enabled(environment, 'BILLING_ENFORCEMENT'),
  });
}

export function publicRuntimeCapabilities(flags = readRuntimeFlags()) {
  return Object.freeze({
    analytics: flags.umamiRuntime === true,
    conversions: flags.nvsRuntime === true,
    pixels: flags.pixels === true,
    media: flags.mediaPipeline === true,
    billing: flags.billingEnforcement === true,
  });
}
