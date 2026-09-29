These test-only OpenType subsets contain space, A and B from the corresponding Latin Modern 2.005 font. They preserve the original glyphs and font names to reproduce incomplete fonts in PDFs. They are never served as recovery fonts.

Source and license: `public/fonts/latin-modern/SOURCE.md` and `public/fonts/latin-modern/v2.005/GUST-FONT-LICENSE.TXT`.

Generated with fontTools 4.x:

```python
from fontTools import subset
from fontTools.ttLib import TTFont

for name in ['lmroman17-regular', 'lmroman10-bolditalic', 'lmsans10-regular', 'lmmono10-regular']:
    font = TTFont(f'public/fonts/latin-modern/v2.005/{name}.otf')
    options = subset.Options()
    options.layout_features = []
    task = subset.Subsetter(options=options)
    task.populate(text=' ABBA')
    task.subset(font)
    font.save(f'tests/fixtures/latin-modern/{name}-subset.otf')
```
