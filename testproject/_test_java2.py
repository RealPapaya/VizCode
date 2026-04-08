import sys, re; sys.path.insert(0, '.')

# Check what the Java pattern actually captures
pat = re.compile(r'^[ \t]*import\s+(static\s+)?([\w.]+)', re.MULTILINE)
java = """
import com.example.MyClass;
import static java.util.Arrays.asList;
import static org.junit.Assert.assertEquals;
import com.google.common.collect.*;
"""
for m in pat.finditer(java):
    print('groups:', m.groups(), '→ full match:', repr(m.group(0)))
