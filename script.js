// E. Aturan Pola Sejenis (Jumlah kartu & tipe kombinasi harus sama)
  if (combo.type === last.type && selectedCards.length === lastPlay.cards.length) {
    // Angka HARUS lebih tinggi
    if (combo.rank > last.rank) return { valid: true, combo: combo };
    
    // Jika angka SAMA (khusus Pair/Single/Tris), kembang/suit tertingginya HARUS lebih tinggi
    if (combo.rank === last.rank && combo.suit > last.suit) {
      return { valid: true, combo: combo };
    }
  }

  return { valid: false, reason: "Kartumu harus lebih tinggi nilainya (atau kembangnya lebih tinggi)!" };
