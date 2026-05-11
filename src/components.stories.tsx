import { Badge, KPI, MiniStat, ProgressBar } from './components';

const meta = { title: 'Base/Feedback' };
export default meta;

export const Estados = {
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      <KPI label="Facturación" value="$ 120.000" tone="good" hint="Mensual" />
      <Badge label="Atención" tone="warn" />
      <MiniStat label="Margen" value="42%" />
      <ProgressBar value={72} />
    </div>
  )
};
