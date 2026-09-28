// A conta de dono num Studio público nasce com o código de instalação, não "pelo servidor
// local" — mensagem que não fazia sentido para quem abre o Studio já em produção.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conferirCriacaoDeConta, exigeCodigoDeInstalacao } from '../server/codigo-de-instalacao.mjs';

const codigo = 'a1b2c3d4e5f6a7b8c9d0';

test('em produção, a conta nasce com o código de instalação certo', () => {
  assert.equal(exigeCodigoDeInstalacao({ publicOrigin: 'https://studio.alvamarketing.com.br' }), true);
  assert.equal(conferirCriacaoDeConta({ publicOrigin: 'https://s.test', codigoEsperado: codigo, codigoInformado: ` ${codigo} ` }), true);
});

test('código errado ou vazio é recusado, e a mensagem não fala de servidor local', () => {
  assert.throws(() => conferirCriacaoDeConta({ publicOrigin: 'https://s.test', codigoEsperado: codigo, codigoInformado: 'errado' }), /Código de instalação inválido/);
  assert.throws(() => conferirCriacaoDeConta({ publicOrigin: 'https://s.test', codigoEsperado: codigo, codigoInformado: '' }), /Código de instalação inválido/);
});

test('sem SETUP_CODE configurado, a tela diz o que falta', () => {
  assert.throws(() => conferirCriacaoDeConta({ publicOrigin: 'https://s.test', codigoEsperado: '', codigoInformado: 'x' }), /SETUP_CODE/);
});

test('sem endereço público, vale só o acesso pelo próprio computador', () => {
  assert.equal(exigeCodigoDeInstalacao({ publicOrigin: '' }), false);
  assert.equal(conferirCriacaoDeConta({ publicOrigin: '', acessoLocal: true }), true);
  assert.throws(() => conferirCriacaoDeConta({ publicOrigin: '', acessoLocal: false }), /próprio computador/);
});
