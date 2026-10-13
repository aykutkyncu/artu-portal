import EmojiPicker, { Categories, EmojiStyle, SuggestionMode, Theme } from 'emoji-picker-react'

// Kategori adları Türkçe; arama emoji adlarının İngilizcesiyle çalışır (kütüphanede Türkçe ad listesi yok).
const CATEGORIES = [
  { category: Categories.SUGGESTED, name: 'Sık kullanılanlar' },
  { category: Categories.SMILEYS_PEOPLE, name: 'İfadeler ve kişiler' },
  { category: Categories.ANIMALS_NATURE, name: 'Hayvanlar ve doğa' },
  { category: Categories.FOOD_DRINK, name: 'Yiyecek ve içecek' },
  { category: Categories.TRAVEL_PLACES, name: 'Seyahat ve yerler' },
  { category: Categories.ACTIVITIES, name: 'Etkinlikler' },
  { category: Categories.OBJECTS, name: 'Nesneler' },
  { category: Categories.SYMBOLS, name: 'Semboller' },
  { category: Categories.FLAGS, name: 'Bayraklar' },
]

/**
 * Bütün emojileri gösteren seçici. Emojiler cihazın kendi yazı tipiyle çizilir (dışarıdan resim indirilmez).
 * Ağır olduğu için ChatView bu dosyayı ilk açılışta yükler (lazy).
 */
export default function EmojiPanel({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <EmojiPicker
      onEmojiClick={(data) => onPick(data.emoji)}
      emojiStyle={EmojiStyle.NATIVE}
      theme={Theme.LIGHT}
      suggestedEmojisMode={SuggestionMode.RECENT}
      categories={CATEGORIES}
      labels={{ searchPlaceholder: 'Emoji ara (İngilizce)', searchResultsNone: 'Emoji bulunamadı', loading: 'Yükleniyor…' }}
      previewConfig={{ showPreview: false }}
      lazyLoadEmojis
      autoFocusSearch={false}
      width="100%"
      height={340}
    />
  )
}
