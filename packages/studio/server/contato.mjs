// E-mail e telefone de quem converteu, normalizados como cada plataforma documenta, e só
// então transformados em hash. Um lugar só: até 27/09 isto estava escrito duas vezes,
// igual para todas as plataformas, e o telefone saía sem código do país.
//
// - Meta: e-mail em minúsculas, sem espaços nas pontas; telefone só com dígitos e com o
//   código do país ("16505551212").
//   https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
// - TikTok: telefone em E.164, com o + ("+12133734253").
//   https://business-api.tiktok.com/portal/docs/parameters/v1.3
// - Google: telefone em E.164 com o +; e-mail em minúsculas e sem espaço nenhum, e no
//   Gmail sem os pontos e sem o sufixo depois do +.
//   https://developers.google.com/data-manager/api/devguides/concepts/formatting
import { createHash } from 'node:crypto';

const hash = (valor) => createHash('sha256').update(valor).digest('hex');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAMPO_DE_EMAIL = /e-?mail/i;
const CAMPO_DE_TELEFONE = /(telefone|phone|celular|whatsapp)/i;

// As três plataformas exigem o código do país "mesmo que todos os dados sejam do mesmo
// país" (Meta). Número sem código, com DDD — 10 ou 11 dígitos —, é tratado como
// brasileiro: o Studio atende agências no Brasil. Decisão pendente de confirmação do dono.
const PAIS_PADRAO = '55';

// O telefone com o código do país, só dígitos; `null` quando não dá para saber qual é.
export function telefoneComPais(bruto) {
  if (typeof bruto !== 'string') return null;
  // O + pode vir antes do primeiro dígito com símbolos na frente: "(+1)2133734253" é o
  // exemplo do próprio TikTok.
  const internacional = /^[^\d]*\+/.test(bruto);
  const digitos = bruto.replace(/\D/g, '');
  if (internacional) return digitos.length >= 8 && digitos.length <= 15 ? digitos : null;
  // Zero à esquerda é prefixo de discagem (0 de longa distância, 00 internacional), não
  // parte do número.
  const semZeros = digitos.replace(/^0+/, '');
  if (semZeros.length === 10 || semZeros.length === 11) return `${PAIS_PADRAO}${semZeros}`;
  if ((semZeros.length === 12 || semZeros.length === 13) && semZeros.startsWith(PAIS_PADRAO)) return semZeros;
  return null;
}

export function emailParaGoogle(bruto) {
  const email = String(bruto ?? '').replace(/\s+/g, '').toLowerCase();
  const arroba = email.lastIndexOf('@');
  if (arroba < 1) return email;
  const [local, dominio] = [email.slice(0, arroba), email.slice(arroba + 1)];
  if (dominio !== 'gmail.com' && dominio !== 'googlemail.com') return email;
  return `${local.split('+')[0].replaceAll('.', '')}@${dominio}`;
}

// Os hashes de contato de um envio, prontos para cada plataforma escolher o seu.
export function hashesDeContato(respostas) {
  const campos = Object.entries(respostas && typeof respostas === 'object' && !Array.isArray(respostas) ? respostas : {});
  const email = campos.find(([nome, valor]) => CAMPO_DE_EMAIL.test(nome) && typeof valor === 'string')?.[1]?.trim().toLowerCase() ?? '';
  const telefone = telefoneComPais(campos.find(([nome, valor]) => CAMPO_DE_TELEFONE.test(nome) && typeof valor === 'string')?.[1]);
  return Object.fromEntries([
    ...(EMAIL.test(email) ? [['email_sha256', hash(email)], ['email_google_sha256', hash(emailParaGoogle(email))]] : []),
    ...(telefone ? [['phone_sha256', hash(telefone)], ['phone_e164_sha256', hash(`+${telefone}`)]] : []),
  ]);
}
