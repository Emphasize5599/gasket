import unittest
from urllib.parse import parse_qs, urlsplit
from site_links import rvparky_link


class SiteLinkTests(unittest.TestCase):
    def test_exact_mask_observed_in_real_browser(self):
        url = rvparky_link('Searcy, AR', 35.26885986328125, -91.7083740234375,
                          categories=['rest_area', 'walmart', 'cabelas', 'cracker_barrel', 'camping_world'],
                          amenities=['overnight_stores'], radius=25)
        q = parse_qs(urlsplit(url).query)
        self.assertEqual(q['f'], ['7ff803e0400000'])
        self.assertEqual(q['d'], ['25'])
        self.assertEqual(q['x'], ['35.26885986328125'])
        self.assertEqual(q['y'], ['-91.7083740234375'])
        self.assertNotIn('s', q, 'No sparse-review/star restriction')

    def test_default_and_multiple_required_amenities(self):
        q = parse_qs(urlsplit(rvparky_link('A&B #1', 0, 0,
                                         amenities=['pets', 'restrooms'])).query)
        self.assertEqual(q['l'], ['A&B #1'])
        self.assertEqual(q['f'], ['7fffffff10080'])
        self.assertNotIn('d', q)

    def test_high_bits_are_preserved_without_combining_chunks(self):
        q = parse_qs(urlsplit(rvparky_link('Place', 0, 0,
                                         categories=['rest_area'], amenities=['fishing'])).query)
        self.assertEqual(q['f'], ['7ff800208000000'])

    def test_unknown_constraints_never_disappear_silently(self):
        for kwargs in [dict(categories=[]), dict(categories=['unknown']),
                       dict(amenities=['free_only']), dict(amenities=['drinking_water']),
                       dict(radius=17)]:
            with self.assertRaises(ValueError):
                rvparky_link('Place', 0, 0, **kwargs)
        with self.assertRaises(ValueError):
            rvparky_link('Place', 91, 0)


if __name__ == '__main__':
    unittest.main()
