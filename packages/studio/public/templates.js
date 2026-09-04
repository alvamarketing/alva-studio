export const services = `<main><section class="hero"><nav class="nav"><strong>SUA EMPRESA<span>®</span></strong><a href="#contato">Vamos conversar ↗</a></nav><div class="hero-grid"><div><p class="kicker">UM NOVO PASSO PARA O SEU NEGÓCIO</p><h1>O próximo capítulo começa com uma boa escolha.</h1><p class="lead">Apresente aqui como sua empresa ajuda o cliente a resolver um problema real. Seja claro sobre o resultado que você entrega.</p><a class="cta" href="#contato">Quero conhecer a solução ↗</a></div><div class="hero-art"><div class="art-circle"></div><span>Ideias claras.<br>Novas possibilidades.</span><small>SEU NEGÓCIO, MAIS LONGE.</small></div></div></section><section class="benefits"><p class="kicker">PENSADO PARA VOCÊ</p><h2>Uma solução que faz sentido<br>para o seu momento.</h2><div class="cards"><article><span>01 /</span><h3>Entendemos seu desafio</h3><p>Explique o primeiro benefício da sua solução com uma frase simples e concreta.</p></article><article><span>02 /</span><h3>Um caminho claro</h3><p>Mostre como funciona o atendimento e o que a pessoa pode esperar ao começar.</p></article><article><span>03 /</span><h3>Estamos por perto</h3><p>Conte o que torna sua abordagem especial, usando informações verdadeiras.</p></article></div></section><section id="contato" class="contact"><div><p class="kicker">VAMOS CONVERSAR</p><h2>Seu próximo passo<br>pode ser simples.</h2><p>Preencha seus dados para conhecer a solução e conversar com nossa equipe.</p></div><form method="post" action="#" onsubmit="return false"><label>Seu nome<input type="text" name="nome" placeholder="Como podemos chamar você?" required></label><label>E-mail<input type="email" name="email" placeholder="voce@empresa.com.br" required></label><label>WhatsApp<input type="tel" name="telefone" placeholder="DDD + número" required></label><button type="submit" class="cta">Quero conversar ↗</button><small>Ao enviar, você solicita contato da nossa equipe. Inclua aqui o link da sua política de privacidade.</small></form></section><footer class="lp-footer">SUA EMPRESA <span>Uma nova possibilidade começa aqui.</span></footer></main>`;
export const templateCss = `*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:#203a32;font-family:Arial,Helvetica,sans-serif;background:#faf9f5}a{color:inherit}h1,h2,h3,p{margin-top:0}.hero{padding:30px 7% 80px;background:#f1f1e9}.nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:80px}.nav strong{letter-spacing:2px}.nav span{color:#698047;margin-left:4px}.nav a{text-decoration:none;font-size:14px}.hero-grid{display:grid;grid-template-columns:1.3fr 1fr;gap:70px;align-items:center}.kicker{font-size:11px;letter-spacing:2px;font-weight:700;margin-bottom:25px}h1{font-size:clamp(38px,5vw,66px);line-height:1.06;letter-spacing:-2.5px;max-width:700px}.lead{font-size:17px;line-height:1.7;max-width:500px;color:#607068}.cta{display:inline-block;padding:17px 24px;background:#d7ec95;border:none;border-radius:5px;color:#203a32;font-weight:700;text-decoration:none;font-size:14px;cursor:pointer}.hero-art{position:relative;min-height:370px;border-radius:130px 8px 8px 8px;background:#264e42;color:#e4eacb;padding:42px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end}.art-circle{position:absolute;border:1px solid #779277;width:300px;height:300px;border-radius:50%;top:-70px;right:-80px;box-shadow:0 0 0 35px #ffffff08,0 0 0 70px #ffffff05}.hero-art span{font-size:32px;line-height:1.2;position:relative}.hero-art small{font-size:9px;letter-spacing:2px;margin-top:32px}.benefits{padding:85px 7%}h2{font-size:38px;letter-spacing:-1.2px;line-height:1.15}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;margin-top:50px}.cards article{border-top:1px solid #cdd3c9;padding-top:25px}.cards article>span{color:#819475;font-size:12px}.cards h3{margin-top:30px;font-size:20px}.cards p,.contact p{line-height:1.7;color:#617269;font-size:15px}.contact{padding:70px 7%;background:#e9eddf;display:grid;grid-template-columns:1fr 1fr;gap:70px}.contact form{padding:32px;background:#fff;border-radius:8px}.contact label{display:block;font-size:12px;font-weight:700;margin-bottom:18px}.contact input{display:block;width:100%;border:1px solid #d9ddd5;border-radius:4px;padding:13px;margin-top:7px;background:#fafbf8}.contact button{width:100%}.contact small{display:block;font-size:10px;line-height:1.6;color:#738079;margin-top:15px}.lp-footer{padding:30px 7%;font-size:12px;display:flex;justify-content:space-between}.lp-footer span{color:#7b857e}@media(max-width:760px){.hero-grid,.contact,.cards{grid-template-columns:1fr;gap:30px}.nav{margin-bottom:45px}.hero{padding-bottom:45px}.hero-art{min-height:260px}.benefits{padding-top:50px;padding-bottom:50px}h2{font-size:30px}.contact{padding:45px 7%}.lp-footer{gap:20px}}`;
export const blocks = [
  [
    'section',
    'Seção',
    'Estrutura',
    '<section style="padding:60px 7%;min-height:140px"><h2>Uma nova seção</h2><p>Conte sua história aqui.</p></section>',
  ],
  [
    'columns',
    'Duas colunas',
    'Estrutura',
    '<div style="display:flex;flex-wrap:wrap;gap:24px;padding:30px"><div style="flex:1;min-width:240px;min-height:100px"><h3>Primeira coluna</h3></div><div style="flex:1;min-width:240px;min-height:100px"><h3>Segunda coluna</h3></div></div>',
  ],
  ['heading', 'Título', 'Conteúdo', '<h2>Seu próximo grande título</h2>'],
  ['text', 'Texto', 'Conteúdo', '<p>Uma mensagem simples, feita para quem precisa da sua solução.</p>'],
  ['image', 'Imagem', 'Conteúdo', { type: 'image' }],
  ['button', 'Botão', 'Conteúdo', '<a href="#contato" class="cta">Quero saber mais ↗</a>'],
  [
    'form',
    'Formulário',
    'Captação',
    '<form method="post" action="#" onsubmit="return false" style="padding:30px"><label>Nome<input name="nome" type="text" required></label><label>E-mail<input name="email" type="email" required></label><button type="submit" class="cta">Enviar</button></form>',
  ],
  [
    'input',
    'Campo de texto',
    'Captação',
    '<label>Novo campo<input name="novo_campo" type="text" placeholder="Digite aqui"></label>',
  ],
];
