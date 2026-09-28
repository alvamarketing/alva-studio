// Os ícones do editor (Lucide): um por bloco na biblioteca, nos campos principais e nos
// botões do cabeçalho. Só o editor carrega isto; a página publicada não.
import {
  AlignCenter, ArrowLeft, Clapperboard, Eye, ClipboardList, Columns2, Columns3, GripVertical, Heading, Image, LayoutGrid,
  Link, Mail, Megaphone, MousePointerClick, MoveHorizontal, PaintBucket, Palette, PanelTop, Quote, Rocket, Rows3,
  Save, Sparkles, Square, Star, StretchVertical, TextCursorInput, Type, Video,
} from 'lucide-react';

export const ICONE_DO_BLOCO = {
  'secao-topo': PanelTop,
  'secao-beneficios': LayoutGrid,
  'secao-depoimento': Quote,
  'secao-chamada': Megaphone,
  'secao-contato': Mail,
  section: Square,
  row: Columns2,
  columns: Columns3,
  heading: Heading,
  text: Type,
  button: MousePointerClick,
  icon: Star,
  image: Image,
  video: Video,
  vsl: Clapperboard,
  form: ClipboardList,
  field: TextCursorInput,
};

export const ICONE_DO_CAMPO = {
  cor: <Palette size={16} />,
  imagem: <Image size={16} />,
  link: <Link size={16} />,
  largura: <MoveHorizontal size={16} />,
  espaco: <StretchVertical size={16} />,
  movimento: <Sparkles size={16} />,
  fundo: <PaintBucket size={16} />,
  alinhamento: <AlignCenter size={16} />,
  estrutura: <Rows3 size={16} />,
};

export { ArrowLeft, Eye, Rocket, Save };

// O item da biblioteca: ícone, nome e a alça de arrastar.
export function ItemDaBiblioteca({ name, rotulo }) {
  const Icone = ICONE_DO_BLOCO[name] ?? Square;
  return (
    <div className="alva-item-da-biblioteca">
      <Icone size={18} aria-hidden="true" />
      <span>{rotulo ?? name}</span>
      <GripVertical size={16} aria-hidden="true" className="alva-alca" />
    </div>
  );
}
