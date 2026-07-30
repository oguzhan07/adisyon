import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_PRINTER_SETTINGS, type PrinterSettings } from '@adisyon/shared';
import { supabase } from './supabase';

/** settings tablosundaki tek satirin sekli */
export interface SettingsRow {
  shop_name: string;
  address: string | null;
  phone: string | null;
  receipt_header: string | null;
  receipt_footer: string | null;
  vat_percent: number;
  business_day_start_hour: number;
  stock_variance_threshold_percent: number;
  printer: PrinterSettings;
}

export const SETTINGS_KEY = ['settings'] as const;

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async (): Promise<SettingsRow> => {
      // Select dizesi TEK literal olmali: Supabase tipleri bu dizeyi tip
      // seviyesinde ayristirir, string birlestirme (+) cikarimi bozar.
      const { data, error } = await supabase
        .from('settings')
        .select(
          `shop_name, address, phone, receipt_header, receipt_footer, vat_percent,
           business_day_start_hour, stock_variance_threshold_percent, printer`,
        )
        .single();

      if (error) throw error;

      const row = data as unknown as SettingsRow;

      return {
        ...row,
        // jsonb alanina eski bir kayittan eksik anahtar gelirse varsayilanla
        // tamamla; arayuz undefined ayarla calismasin
        printer: { ...DEFAULT_PRINTER_SETTINGS, ...row.printer },
      };
    },
    // Ayarlar nadiren degisir; her ekran gecisinde yeniden cekmeye gerek yok
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patch: Partial<SettingsRow>) => {
      const { error } = await supabase.from('settings').update(patch).eq('id', true);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}

/** Fis sablonlarinin bekledigi dukkan bilgisi bloguna cevirir */
export function toReceiptShopInfo(settings: SettingsRow) {
  return {
    shopName: settings.shop_name,
    address: settings.address,
    phone: settings.phone,
    header: settings.receipt_header,
    footer: settings.receipt_footer,
  };
}
