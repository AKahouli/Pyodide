/**
 * ColorPicker - Color picker with hex input + native color preview, synced.
 */

import { Input } from '@/components/ui/input';

interface ColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function ColorPicker({ value, onChange, placeholder = '#000000', className = '' }: Readonly<ColorPickerProps>) {
  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let hex = e.target.value;
    if (!hex.startsWith('#')) {
      hex = `#${hex}`;
    }
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      onChange(hex);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Input
        type='color'
        value={value || '#000000'}
        onChange={handleColorChange}
        className='w-12 h-10 p-0.5 border-0 cursor-pointer'
        style={{ padding: 0 }}
      />
      <Input
        type='text'
        value={value}
        onChange={handleHexChange}
        placeholder={placeholder}
        className='flex-1 uppercase font-mono'
        maxLength={7}
      />
    </div>
  );
}
