// Optioneel: vul dit in zodat alle gezinsleden meteen gekoppeld zijn.
// De anon key is bedoeld om publiek te zijn; de data wordt beschermd door de gezinscode (zie supabase/schema.sql).
export const DEFAULTS = {
  supabaseUrl: '',
  supabaseKey: '',
  family: '',
  googleKey: '' // Google Books API-sleutel (zie README), voorkomt de gedeelde dagelijkse limiet
};
