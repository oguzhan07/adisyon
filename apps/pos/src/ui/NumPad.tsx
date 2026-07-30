import { Button } from './Button';

interface Props {
  /** Girilen ham metin (or. "12,50") */
  value: string;
  onChange: (value: string) => void;
  /** Ondalik giris (tutar) icin virgul tusu acilir; adet icin kapali */
  decimal?: boolean;
}

/**
 * Ekran uzerinde sayi tusu. Fiziksel klavye olmayan dokunmatik kasada
 * tutar / adet / miktar girisi icin. Buyuk hedefler (dokunmatik dostu).
 */
export function NumPad({ value, onChange, decimal = true }: Props) {
  function press(key: string) {
    if (key === 'del') {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === ',') {
      if (!decimal || value.includes(',')) return;
      onChange(value === '' ? '0,' : `${value},`);
      return;
    }
    // Bastaki gereksiz sifiri engelle ("00" olmasin)
    if (value === '0' && key !== ',') {
      onChange(key);
      return;
    }
    onChange(value + key);
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimal ? ',' : '', '0', 'del'];

  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((key, index) =>
        key === '' ? (
          <div key={index} />
        ) : (
          <Button
            key={index}
            variant="secondary"
            size="lg"
            onClick={() => press(key)}
            className="text-xl"
          >
            {key === 'del' ? '⌫' : key}
          </Button>
        ),
      )}
    </div>
  );
}
