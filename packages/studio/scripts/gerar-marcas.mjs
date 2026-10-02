// Gera public/marcas.js: os logos das plataformas de anúncio da aba Rastreamento, tirados do
// pacote simple-icons (CC0-1.0). Só o caminho SVG e a cor oficial de cada marca; o desenho
// não é refeito à mão. As marcas pertencem às empresas: o uso aqui é só para identificar a
// integração. Marca que o pacote não traz (o LinkedIn saiu do simple-icons a pedido da
// empresa; a Taboola nunca entrou) fica com a inicial num quadrado neutro — nunca um
// desenho inventado. Rodar de novo ao trocar a versão do pacote: `npm run build:marcas`.
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as simpleIcons from 'simple-icons';

// Chave usada na tela → nome do ícone no simple-icons, e a inicial se ele faltar.
export const PEDIDAS = Object.freeze({
  meta: ['siMeta', 'M'],
  facebook: ['siFacebook', 'f'],
  tiktok: ['siTiktok', 'T'],
  googleads: ['siGoogleads', 'G'],
  linkedin: ['siLinkedin', 'in'],
  taboola: ['siTaboola', 'Tb'],
});

export function fonteDasMarcas(pacote = simpleIcons) {
  const marcas = {};
  const semLogo = {};
  for (const [chave, [nome, inicial]] of Object.entries(PEDIDAS)) {
    const icone = pacote[nome];
    if (icone) marcas[chave] = { titulo: icone.title, hex: icone.hex, caminho: icone.path, fonte: icone.source };
    else semLogo[chave] = { inicial };
  }
  return `// Gerado por scripts/gerar-marcas.mjs a partir do pacote simple-icons (CC0-1.0). Não editar à mão.
//
// Logos das plataformas de anúncio: caminho SVG e cor oficial (hex) de cada marca. As marcas
// são das empresas; o uso é só para identificar a integração. As cores estão também em
// owner.css (--marca-*), o único lugar do CSS com cor de marca.
export const MARCAS = Object.freeze(${JSON.stringify(marcas, null, 1)});

// Marcas que o simple-icons não traz: a tela mostra a inicial num quadrado neutro.
export const SEM_LOGO = Object.freeze(${JSON.stringify(semLogo, null, 1)});

export function svgDaMarca(chave) {
  const marca = MARCAS[chave];
  if (!marca) return '';
  return \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"><path d="\${marca.caminho}"/></svg>\`;
}
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const fonte = fonteDasMarcas();
  await writeFile(new URL('../public/marcas.js', import.meta.url), fonte);
  const ausentes = Object.entries(PEDIDAS).filter(([, [nome]]) => !simpleIcons[nome]).map(([chave]) => chave);
  console.log(`public/marcas.js gerado. Sem logo no simple-icons: ${ausentes.join(', ') || 'nenhuma'}`);
}
