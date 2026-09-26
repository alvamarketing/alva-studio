function enabled(environment, name) {
  return environment?.[name] === 'true';
}

export function billingRuntimeEnvironment(environment = process.env) {
  return environment?.ASAAS_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
}

export function readRuntimeFlags(environment = process.env) {
  return Object.freeze({
    conversions: enabled(environment, 'CONVERSIONS_ENABLED'),
    pixels: enabled(environment, 'PIXELS_ENABLED'),
    mediaPipeline: enabled(environment, 'MEDIA_PIPELINE_ENABLED'),
    billingEnforcement: enabled(environment, 'BILLING_ENFORCEMENT'),
  });
}

export function requiredTrackingEngines(flags = readRuntimeFlags()) {
  return Object.freeze([
    ...(flags.conversions === true ? ['conversions'] : []),
  ]);
}

export function publicRuntimeCapabilities(flags = readRuntimeFlags()) {
  return Object.freeze({
    // O analytics é do próprio Studio desde que o Umami foi absorvido: deixou de ser
    // uma capacidade que depende de um serviço externo estar no ar.
    analytics: true,
    conversions: flags.conversions === true,
    pixels: flags.pixels === true,
    media: flags.mediaPipeline === true,
    billing: flags.billingEnforcement === true,
  });
}
