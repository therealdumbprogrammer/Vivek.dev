import java.lang.instrument.Instrumentation;
import com.sun.management.HotSpotDiagnosticMXBean;
import java.lang.management.ManagementFactory;
public class SizeProbe {
  static class User { int id; boolean active; Object ref; }
  static class VerifiedUser { int id; boolean active; Object ref; boolean verified; }
  public static void premain(String args, Instrumentation inst) {
    var vm = ManagementFactory.getPlatformMXBean(HotSpotDiagnosticMXBean.class);
    for (String key : new String[]{"UseCompressedOops", "UseCompressedClassPointers", "ObjectAlignmentInBytes", "UseCompactObjectHeaders"})
      System.out.println(key + "=" + vm.getVMOption(key).getValue());
    System.out.println("User shallow size=" + inst.getObjectSize(new User()));
    System.out.println("VerifiedUser shallow size=" + inst.getObjectSize(new VerifiedUser()));
  }
  public static void main(String[] args) {}
}
