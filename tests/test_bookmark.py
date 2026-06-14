import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bookmark

def test_validate_url():
    # scheme must be http/https
    assert bookmark.validate_bookmark_url("ftp://example.com") is not None
    assert bookmark.validate_bookmark_url("file:///etc/passwd") is not None
    assert bookmark.validate_bookmark_url("javascript:alert(1)") is not None
    assert bookmark.validate_bookmark_url("not a url") is not None
    # SSRF: private / loopback / link-local IP literals rejected (no DNS needed)
    assert bookmark.validate_bookmark_url("http://127.0.0.1/") is not None
    assert bookmark.validate_bookmark_url("http://10.0.0.5/") is not None
    assert bookmark.validate_bookmark_url("http://192.168.1.1/") is not None
    assert bookmark.validate_bookmark_url("http://169.254.1.1/") is not None
    assert bookmark.validate_bookmark_url("http://[::1]/") is not None
    # a public IP literal passes (no DNS, no network)
    assert bookmark.validate_bookmark_url("https://93.184.216.34/") is None

def test_extract_readable():
    html = """
    <html><head><title>Judul Halaman</title></head>
    <body>
      <nav>menu noise</nav>
      <article><h1>Judul Artikel</h1>
        <p>Paragraf pertama yang cukup panjang untuk dianggap konten utama oleh extractor.</p>
        <p>Paragraf kedua dengan isi bermakna lainnya di dalam artikel ini.</p>
      </article>
      <footer>footer noise</footer>
    </body></html>
    """
    out = bookmark.extract_readable(html, "https://example.com/a")
    assert isinstance(out, dict)
    assert "Paragraf pertama" in out["content"]
    assert "menu noise" not in out["content"]
    assert out["title"]  # non-empty title

def test_extract_readable_empty():
    out = bookmark.extract_readable("<html><body></body></html>", "https://example.com/x")
    assert out["content"] == ""
    assert isinstance(out["title"], str)

if __name__ == "__main__":
    test_validate_url()
    print("OK test_validate_url")
    test_extract_readable(); print("OK test_extract_readable")
    test_extract_readable_empty(); print("OK test_extract_readable_empty")
