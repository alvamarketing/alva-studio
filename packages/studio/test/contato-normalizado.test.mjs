// E-mail e telefone como cada plataforma pede, antes do hash.
//
// Até 27/09 o contato era normalizado em dois lugares, do mesmo jeito para todas as
// plataformas, e o telefone saía sem código do país. As três documentações exigem o
// código, e não concordam no resto: a Meta quer só dígitos, o TikTok e o Google querem
// E.164 com `+`, e o Google tira os pontos do Gmail. Os exemplos abaixo são os das
// próprias documentações.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { emailParaGoogle, hashesDeContato, telefoneComPais } from '../server/contato.mjs';

const sha = (valor) => createHash('sha256').update(valor).digest('hex');

// https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
test('Meta: os exemplos da documentação dão o hash esperado', () => {
  const contato = hashesDeContato({ email: 'John_Smith@gmail.com', telefone: '+1 (650) 555-1212' });
  assert.equal(contato.email_sha256, '62a14e44f765419d10fea99367361a727c12365e2520f32218d505ed9aa0f62f');
  assert.equal(contato.phone_sha256, 'e323ec626319ca94ee8bff2e4c87cf613be6ea19919ed1364124e16807ab3176');
});

// https://business-api.tiktok.com/portal/docs/parameters/v1.3 e
// https://developers.google.com/data-manager/api/devguides/concepts/formatting
test('TikTok e Google: telefone em E.164, com o +', () => {
  assert.equal(hashesDeContato({ telefone: '(+1)2133734253' }).phone_e164_sha256, sha('+12133734253'));
  assert.equal(hashesDeContato({ phone: '+1 (800) 555-0100' }).phone_e164_sha256, sha('+18005550100'));
});

test('Google: no Gmail saem os pontos e o sufixo +; nos outros domínios, não', () => {
  assert.equal(emailParaGoogle('cloudy.sanfrancisco+shopping@gmail.com'), 'cloudysanfrancisco@gmail.com');
  assert.equal(emailParaGoogle('Ana.Souza@GoogleMail.com'), 'anasouza@googlemail.com');
  assert.equal(emailParaGoogle('user.name+NYC@Example.com'), 'user.name+nyc@example.com');
  assert.equal(emailParaGoogle(' a na@exemplo.com '), 'ana@exemplo.com');
  const contato = hashesDeContato({ email: 'cloudy.sanfrancisco+shopping@gmail.com' });
  assert.equal(contato.email_google_sha256, sha('cloudysanfrancisco@gmail.com'));
  assert.equal(contato.email_sha256, sha('cloudy.sanfrancisco+shopping@gmail.com'), 'a Meta não tira os pontos');
});

// Decisão pendente do dono: número sem código do país, com DDD, é tratado como
// brasileiro. As três plataformas exigem o código; sem ele o hash não casa.
test('telefone brasileiro sem código do país ganha o 55', () => {
  for (const digitado of ['(11) 98765-4321', '11987654321', '011 98765-4321', '+55 11 98765-4321', '5511987654321', '55 (11) 98765-4321']) {
    assert.equal(telefoneComPais(digitado), '5511987654321', digitado);
  }
  assert.equal(telefoneComPais('(11) 3456-7890'), '551134567890', 'fixo com DDD');
});

test('telefone que não dá para normalizar não vira hash', () => {
  for (const digitado of ['123', '9876-5432', 'sem número', '', null]) {
    assert.equal(telefoneComPais(digitado), null, String(digitado));
  }
  assert.deepEqual(hashesDeContato({ telefone: '9876-5432' }), {});
});

test('o campo é reconhecido pelo nome, e e-mail inválido não vira hash', () => {
  assert.ok(hashesDeContato({ 'Seu e-mail': 'a@b.co' }).email_sha256);
  assert.ok(hashesDeContato({ whatsapp: '11987654321' }).phone_sha256);
  assert.deepEqual(hashesDeContato({ email: 'não é e-mail' }), {});
  assert.deepEqual(hashesDeContato(null), {});
});
