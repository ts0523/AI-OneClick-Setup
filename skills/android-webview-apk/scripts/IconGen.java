/*
 * 生成传统启动图标（API 21~25 及部分启动器需要位图图标）。
 * 与 res/drawable/ic_launcher_foreground.xml 使用同一套 108 网格坐标，保证
 * 自适应图标与位图图标视觉一致。
 *
 * 只用 JDK 自带的 Java2D + ImageIO，不引第三方库。
 * 用法: java IconGen <输出目录>
 */
import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.geom.Path2D;
import java.awt.geom.Rectangle2D;
import java.awt.image.BufferedImage;
import java.io.File;

public class IconGen {

    /* ---- 108 网格上的设计坐标（与 vector drawable 一致） ---- */
    private static final float[] ROUTE = {38f, 76f, 38f, 58f, 56f, 58f, 56f, 40f, 74f, 40f, 74f, 24f};
    private static final float ROUTE_W = 9f;
    private static final float MARK_X = 66f, MARK_Y = 16f, MARK_S = 16f, MARK_STROKE = 5f;

    private static final Color BG = new Color(0x0A, 0x0A, 0x0C);
    private static final Color GREEN = new Color(0xA3, 0xE6, 0x35);
    private static final Color ORANGE = new Color(0xF9, 0x73, 0x16);

    /* 内容外接框（含描边），用于把图形摆到画布正中 */
    private static final float BB_X0 = 33.5f, BB_Y0 = 13.5f, BB_X1 = 84.5f, BB_Y1 = 80.5f;

    public static void main(String[] args) throws Exception {
        File outRoot = new File(args[0]);
        gen(outRoot, "mipmap-mdpi", 48);
        gen(outRoot, "mipmap-hdpi", 72);
        gen(outRoot, "mipmap-xhdpi", 96);
        gen(outRoot, "mipmap-xxhdpi", 144);
        gen(outRoot, "mipmap-xxxhdpi", 192);
        System.out.println("icon: 5 densities written to " + outRoot.getAbsolutePath());
    }

    private static void gen(File root, String dir, int px) throws Exception {
        BufferedImage img = new BufferedImage(px, px, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);

        // 底色满铺
        g.setColor(BG);
        g.fillRect(0, 0, px, px);

        // 把内容外接框缩放到画布 84% 并居中
        float bw = BB_X1 - BB_X0, bh = BB_Y1 - BB_Y0;
        float scale = px * 0.84f / Math.max(bw, bh);
        g.translate(px / 2.0, px / 2.0);
        g.scale(scale, scale);
        g.translate(-(BB_X0 + bw / 2f), -(BB_Y0 + bh / 2f));

        // 轨迹折线
        Path2D.Float route = new Path2D.Float();
        route.moveTo(ROUTE[0], ROUTE[1]);
        for (int i = 2; i < ROUTE.length; i += 2) {
            route.lineTo(ROUTE[i], ROUTE[i + 1]);
        }
        g.setStroke(new BasicStroke(ROUTE_W, BasicStroke.CAP_SQUARE, BasicStroke.JOIN_MITER));
        g.setColor(GREEN);
        g.draw(route);

        // 终点方块（先描底色再填橙，形成切割感）
        Rectangle2D.Float mark = new Rectangle2D.Float(MARK_X, MARK_Y, MARK_S, MARK_S);
        g.setStroke(new BasicStroke(MARK_STROKE, BasicStroke.CAP_BUTT, BasicStroke.JOIN_MITER));
        g.setColor(BG);
        g.draw(mark);
        g.setColor(ORANGE);
        g.fill(mark);

        g.dispose();

        File dir2 = new File(root, dir);
        dir2.mkdirs();
        File f = new File(dir2, "ic_launcher.png");
        ImageIO.write(img, "png", f);
        System.out.println("  " + dir + "/ic_launcher.png  " + px + "x" + px + "  " + f.length() + "B");
    }
}
