import { Header } from '../Header';

export default function HeaderExample() {
  return <Header onMenuClick={() => console.log('Menu clicked')} />;
}
