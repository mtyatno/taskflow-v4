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

if __name__ == "__main__":
    test_validate_url()
    print("OK test_validate_url")
