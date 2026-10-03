// O formulário da landing: tipos novos de campo, campos lado a lado, isca contra robô e o
// que acontece depois do envio — do esquema ao lead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPO_ISCA, normalizeNode, renderConteudo, renderNode } from '../public/page-schema.js';
import { capturasDoEstado, normalizarEstadoAlva } from '../public/pagina-alva.js';
import { camposPadraoDoFormulario } from '../public/secoes-prontas.js';
import { separarIsca, validatePageCaptureAnswers } from '../server/page-capture-schema.mjs';
import { displayLeadAnswer } from '../public/leads-ui.js';
import { renderLeadsCsv } from '../server/leads-csv.mjs';
import { renderCompletion } from '../server/pagina-de-obrigado.mjs';

const FORM = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const campo = (props) => ({ type: 'field', props, children: [] });
const pagina = (formProps = {}, campos = []) => normalizarEstadoAlva({ formato: 'alva/1', root: { title: 'LP' }, content: [
  { type: 'section', props: {}, children: [{ id: FORM, type: 'form', props: { submitLabel: 'Enviar', ...formProps }, children: campos }] },
] });

test('formulário novo nasce com Nome, E-mail e Telefone', () => {
  assert.deepEqual(camposPadraoDoFormulario().map((no) => [no.type, no.props.label, no.props.fieldType, no.props.required]), [
    ['field', 'Nome', 'text', true], ['field', 'E-mail', 'email', true], ['field', 'Telefone', 'tel', false],
  ]);
});

test('as opções de lista e escolha única são limpas: sem vazias, sem repetidas, até 20', () => {
  const limpo = normalizeNode(campo({ label: 'Interesse', fieldType: 'select', opcoes: [{ rotulo: ' A ' }, { rotulo: '' }, { rotulo: 'A' }, 'B', null, ...Array.from({ length: 30 }, (_, i) => ({ rotulo: `X${i}` }))] }));
  assert.deepEqual(limpo.props.opcoes.slice(0, 3), [{ rotulo: 'A' }, { rotulo: 'B' }, { rotulo: 'X0' }]);
  assert.equal(limpo.props.opcoes.length, 20);
  assert.throws(() => normalizeNode(campo({ label: 'X', fieldType: 'script' })), /não suportado/);
});

test('lista suspensa, escolha única e caixa de marcar viram HTML de formulário, escapado', () => {
  const lista = renderConteudo(campo({ label: 'Interesse', name: 'interesse', fieldType: 'select', required: true, opcoes: [{ rotulo: 'Sites' }, { rotulo: '<b>Tráfego</b>' }] }));
  assert.match(lista, /<select class="answer" name="interesse" required><option value="">Selecione<\/option><option value="Sites">Sites<\/option>/);
  assert.match(lista, /&lt;b&gt;Tráfego&lt;\/b&gt;/);
  const escolha = renderConteudo(campo({ label: 'Prefere', name: 'prefere', fieldType: 'radio', opcoes: [{ rotulo: 'WhatsApp' }, { rotulo: 'E-mail' }] }));
  assert.match(escolha, /<fieldset class="answer-wrap alva-campo-escolha"><legend>Prefere<\/legend>/);
  assert.equal(escolha.match(/type="radio" name="prefere"/g).length, 2);
  const marcar = renderConteudo(campo({ label: 'Aceito receber contato', name: 'aceito', fieldType: 'checkbox', required: true }));
  assert.match(marcar, /<label class="answer-wrap alva-campo-marcar"><input type="checkbox" name="aceito" value="sim" required><span>Aceito receber contato<\/span><\/label>/);
});

test('campo de metade ou terço fica lado a lado; o formulário embrulha os campos para isso', () => {
  assert.match(renderConteudo(campo({ label: 'Nome', name: 'nome', fieldType: 'text', largura: 'metade' })), /class="answer-wrap alva-campo-metade"/);
  assert.match(renderConteudo(campo({ label: 'UF', name: 'uf', fieldType: 'text', largura: 'terco' })), /class="answer-wrap alva-campo-terco"/);
  assert.equal(normalizeNode(campo({ label: 'X', fieldType: 'text', largura: 'gigante' })).props.largura, 'inteira');
  const html = renderNode({ id: FORM, type: 'form', props: {}, children: [campo({ label: 'Nome', name: 'nome', fieldType: 'text' })] });
  assert.match(html, /<form class="alva-form"[^>]*><div class="alva-form-campos"><label class="answer-wrap">Nome/);
});

test('todo formulário leva a isca invisível que robô preenche e gente não vê', () => {
  const html = renderNode({ id: FORM, type: 'form', props: {}, children: [] });
  assert.match(html, new RegExp(`<div class="alva-isca" aria-hidden="true">.*name="${CAMPO_ISCA}"[^>]*tabindex="-1"[^>]*autocomplete="off"`));
  assert.ok(html.indexOf(CAMPO_ISCA) < html.indexOf('type="submit"'));
});

test('dois campos com o mesmo nome no formulário ganham nomes distintos', () => {
  const estado = pagina({}, [campo({ label: 'E-mail', name: 'email', fieldType: 'email' }), campo({ label: 'Outro e-mail', name: 'email', fieldType: 'email' })]);
  assert.deepEqual(estado.content[0].children[0].children.map((no) => no.props.name), ['email', 'email_2']);
  assert.deepEqual(normalizarEstadoAlva(estado), estado);
});

test('a captura publicada leva as opções permitidas e a caixa de marcar como booleana', () => {
  const { forms: [captura] } = capturasDoEstado(pagina({}, [
    campo({ label: 'Interesse', name: 'interesse', fieldType: 'select', opcoes: [{ rotulo: 'Sites' }, { rotulo: 'Tráfego' }], required: true }),
    campo({ label: 'Prefere', name: 'prefere', fieldType: 'radio', opcoes: [{ rotulo: 'WhatsApp' }] }),
    campo({ label: 'Aceito', name: 'aceito', fieldType: 'checkbox', required: true }),
  ]));
  assert.deepEqual(captura.fields, [
    { id: 'interesse', type: 'single_choice', title: 'Interesse', required: true, options: ['Sites', 'Tráfego'] },
    { id: 'prefere', type: 'single_choice', title: 'Prefere', required: false, options: ['WhatsApp'] },
    { id: 'aceito', type: 'checkbox', title: 'Aceito', required: true },
  ]);
  assert.deepEqual(validatePageCaptureAnswers(captura, { answers: { interesse: 'Sites', aceito: 'sim' } }), { interesse: 'Sites', prefere: '', aceito: true });
  assert.throws(() => validatePageCaptureAnswers(captura, { answers: { interesse: 'Outra', aceito: 'sim' } }), /Escolha uma resposta válida/);
  assert.throws(() => validatePageCaptureAnswers(captura, { answers: { interesse: 'Sites' } }), /Marque “Aceito”/);
  assert.throws(() => validatePageCaptureAnswers(captura, { answers: { interesse: 'Sites', aceito: '<script>' } }), /inválid/);
});

test('caixa de marcar opcional não marcada vira "não"', () => {
  const { forms: [captura] } = capturasDoEstado(pagina({}, [campo({ label: 'Novidades', name: 'novidades', fieldType: 'checkbox' })]));
  assert.deepEqual(validatePageCaptureAnswers(captura, { answers: {} }), { novidades: false });
});

test('lista sem nenhuma opção não publica: ninguém conseguiria responder', () => {
  assert.throws(() => capturasDoEstado(pagina({}, [campo({ label: 'Interesse', name: 'interesse', fieldType: 'select', opcoes: [] })])), /pelo menos uma opção/);
});

test('depois de enviar: mensagem própria, ou redirecionar só para http(s)', () => {
  const mensagem = capturasDoEstado(pagina({ depoisDeEnviar: 'mensagem', mensagemDeSucesso: 'Valeu! Te chamamos hoje.' })).forms[0];
  assert.deepEqual(mensagem.completion, { tipo: 'mensagem', mensagem: 'Valeu! Te chamamos hoje.' });
  const redirecionar = capturasDoEstado(pagina({ depoisDeEnviar: 'redirecionar', redirecionarPara: 'https://exemplo.test/obrigado' })).forms[0];
  assert.deepEqual(redirecionar.completion, { tipo: 'redirecionar', url: 'https://exemplo.test/obrigado' });
  for (const hostil of ['javascript:alert(1)', 'data:text/html,oi', '//sem-esquema.test', 'https://exemplo.test/"><script>']) {
    const estado = pagina({ depoisDeEnviar: 'redirecionar', redirecionarPara: hostil });
    assert.equal(estado.content[0].children[0].props.redirecionarPara, '', hostil);
    assert.deepEqual(capturasDoEstado(estado).forms[0].completion, {}, hostil);
  }
  assert.deepEqual(capturasDoEstado(pagina()).forms[0].completion, {});
});

test('a página de obrigado mostra a mensagem, ou leva ao endereço escolhido', () => {
  assert.match(renderCompletion('Obrigado!', 'Valeu <3'), /<p>Valeu &lt;3<\/p>/);
  const indo = renderCompletion('Obrigado!', 'Indo…', { redirecionar: 'https://exemplo.test/a?b=1&c=2' });
  assert.match(indo, /<meta http-equiv="refresh" content="0;url=https:\/\/exemplo.test\/a\?b=1&amp;c=2">/);
  assert.match(indo, /<a href="https:\/\/exemplo.test\/a\?b=1&amp;c=2">Continuar<\/a>/);
  for (const hostil of ['javascript:alert(1)', 'https://x.test/"><script>alert(1)</script>'])
    assert.doesNotMatch(renderCompletion('Obrigado!', 'x', { redirecionar: hostil }), /refresh|javascript|<script/);
});

test('a isca preenchida marca o envio como robô; vazia, sai das respostas', () => {
  assert.deepEqual(separarIsca({ answers: { email: 'a@b.test', [CAMPO_ISCA]: 'http://spam.test' } }), { isca: true, input: { answers: { email: 'a@b.test' } } });
  assert.deepEqual(separarIsca({ answers: { email: 'a@b.test', [CAMPO_ISCA]: '' } }), { isca: false, input: { answers: { email: 'a@b.test' } } });
  assert.deepEqual(separarIsca({ answers: { email: 'a@b.test' } }), { isca: false, input: { answers: { email: 'a@b.test' } } });
});

test('em Leads, a caixa de marcar aparece como Sim ou Não', () => {
  assert.equal(displayLeadAnswer(true), 'Sim');
  assert.equal(displayLeadAnswer(false), 'Não');
  const csv = renderLeadsCsv({ fields: [{ id: 'aceito', title: 'Aceito' }], submissions: [{ answers: { aceito: true }, fields: [{ id: 'aceito', title: 'Aceito' }] }] });
  assert.match(csv, /Sim/);
});
