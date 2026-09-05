const ROLE_CAPABILITIES = {
  owner: [
    'company.manage',
    'billing.manage',
    'member.manage',
    'project.manage',
    'page.write',
    'form.write',
    'video.write',
    'submission.read',
    'integration.manage',
    'deployment.publish',
  ],
  admin: [
    'member.manage',
    'project.manage',
    'page.write',
    'form.write',
    'video.write',
    'submission.read',
    'integration.manage',
    'deployment.publish',
  ],
  editor: ['page.write', 'form.write', 'video.write', 'submission.read'],
  analyst: ['submission.read', 'analytics.read', 'video.read'],
};

export const ROLES = Object.freeze(Object.keys(ROLE_CAPABILITIES));
export const CAPABILITIES = Object.freeze(
  Object.fromEntries(ROLES.map((role) => [role, Object.freeze([...ROLE_CAPABILITIES[role]])])),
);

const RESERVED_ROUTE_PREFIXES = ['/api', '/_next', '/.well-known', '/admin', '/f'];
const ASCII_SEGMENT = /^[a-z0-9-]+$/;

function foldText(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function slugify(value) {
  return foldText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export function capabilitiesFor(role) {
  return CAPABILITIES[role] ?? Object.freeze([]);
}

export function hasCapability(role, capability) {
  return capabilitiesFor(role).includes(capability);
}

export function normalizeProjectSlug(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('slug inválido');
  const slug = slugify(value);
  if (!slug) throw new Error('slug inválido');
  return slug;
}

export function normalizeRoute(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('rota inválida');
  const text = foldText(value).trim();
  if (text === '/') return '/';

  const route = `/${text.replace(/^\//, '').replace(/\/$/, '')}`;
  if (route.length > 120) throw new Error('rota excede 120 caracteres');

  const segments = route.slice(1).split('/');
  if (segments.some((segment) => segment === '')) {
    throw new Error('rota não pode conter segmentos vazios');
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('rota contém segmento reservado');
  }
  if (segments.some((segment) => !ASCII_SEGMENT.test(segment))) {
    throw new Error('rota contém caracteres não permitidos');
  }

  const normalized = `/${segments.join('/')}`;
  if (RESERVED_ROUTE_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    throw new Error('rota reservada');
  }
  return normalized;
}
