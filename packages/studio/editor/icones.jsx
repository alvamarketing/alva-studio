// Os ícones do editor (Lucide): um por bloco na biblioteca, nos campos principais e nos
// botões do cabeçalho. Só o editor carrega isto; a página publicada não.
import {
  Anchor, AppWindow, EyeOff, FileText, Send, Share2,
  AlignCenter, ArrowLeft, CircleCheck, Inbox, ListChecks, Milestone, CircleDot, Clapperboard, Eye, ClipboardList, Columns2, Columns3, GripVertical, Heading, Image, LayoutGrid,
  Link, Mail, Megaphone, MousePointerClick, MoveHorizontal, PaintBucket, Palette, PanelLeft, PanelRight, PanelTop, Quote, Redo2, Rocket, Rows3,
  Save, Sparkles, Square, Star, StretchVertical, TextCursorInput, Type, Undo2, Video,
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
  etapa: Milestone,
  escolha: ListChecks,
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
  ancora: <Anchor size={16} />,
  descricao: <FileText size={16} />,
  compartilhar: <Share2 size={16} />,
  aba: <AppWindow size={16} />,
  google: <EyeOff size={16} />,
  envio: <Send size={16} />,
};

export { ArrowLeft, CircleCheck, CircleDot, Eye, Inbox, PanelLeft, PanelRight, Redo2, Rocket, Save, Undo2 };

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
