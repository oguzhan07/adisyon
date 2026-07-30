import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { qk } from './queryKeys';
import type { Area, RestaurantTable } from './dbTypes';

/** Bolge ve masa yonetimi (Ayarlar ekrani icin) */
export function useVenueMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.areas });
    void queryClient.invalidateQueries({ queryKey: qk.tables });
  };

  const saveArea = useMutation({
    mutationFn: async (input: Partial<Area> & { name: string }) => {
      if (input.id) {
        const { error } = await supabase.from('areas').update(input).eq('id', input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('areas').insert(input);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  const saveTable = useMutation({
    mutationFn: async (
      input: Partial<RestaurantTable> & { name: string; area_id: string },
    ) => {
      if (input.id) {
        const { error } = await supabase.from('restaurant_tables').update(input).eq('id', input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('restaurant_tables').insert(input);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  const removeTable = useMutation({
    mutationFn: async (id: string) => {
      // Acik adisyonu olan masa silinemez (FK RESTRICT); pasife almak daha guvenli
      const { error } = await supabase
        .from('restaurant_tables')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { saveArea, saveTable, removeTable };
}
