import java.nio.ByteBuffer;
public class MemoryProbe {
  public static void main(String[] args) throws Exception {
    ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);
    System.out.println("Ready: direct capacity=" + buffer.capacity());
    System.in.read();
    System.out.println(buffer.get(0));
  }
}
